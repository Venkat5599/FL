/**
 * Self-contained X (Twitter) timeline scraper — no external deps, Node built-ins
 * only. Resolves a handle to its user id, paginates the UserTweets GraphQL
 * endpoint, and writes a JSON array that `importArchive` ingests directly.
 *
 * Auth: uses the burner `auth_token` cookie (from .env) plus a self-generated
 * `ct0` (X's CSRF double-submit — header must equal the cookie). Query IDs and
 * the public web Bearer are current as of the last update; if X rotates them,
 * a resolve/fetch will 404 ("Query not found") and they must be refreshed.
 *
 * Usage: node --env-file=.env --import tsx scripts/scrape-x.ts <handle> [limit] [outFile]
 * Be a good citizen: keep limits modest and let the built-in delay pace pages.
 */
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";

const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const GRAPHQL_BASE = "https://x.com/i/api/graphql";
const Q_USER_BY_SCREEN_NAME = "NimuplG1OB7Fd2btCLdBOw";
const Q_USER_TWEETS = "QWF3SzpHmykQHsQMixG0cg";

const DEFAULT_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_profile_redirect_enabled: false,
};
const USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authHeaders(): Record<string, string> {
  const auth = process.env.auth_token;
  if (!auth) throw new Error("auth_token not set in environment (.env)");
  const ct0 = randomBytes(16).toString("hex");
  return {
    authorization: `Bearer ${decodeURIComponent(BEARER)}`,
    cookie: `auth_token=${auth}; ct0=${ct0}`,
    "x-csrf-token": ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped X GraphQL JSON
async function graphql(queryId: string, op: string, variables: object, features: object): Promise<any> {
  const url =
    `${GRAPHQL_BASE}/${queryId}/${op}` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&features=${encodeURIComponent(JSON.stringify(features))}`;
  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  // X returns {data:{...}}; tolerate an extra wrapper defensively.
  return json.data?.data ?? json.data ?? json;
}

async function resolveUserId(handle: string): Promise<string> {
  const data = await graphql(
    Q_USER_BY_SCREEN_NAME,
    "UserByScreenName",
    { screen_name: handle, withSafetyModeUserFields: true },
    USER_FEATURES
  );
  const result = data?.user?.result;
  if (!result || result.__typename === "UserUnavailable") {
    throw new Error(`user @${handle} not found (renamed, suspended, or bad handle)`);
  }
  return result.rest_id;
}

export type ScrapedTweet = { id_str: string; full_text: string; created_at: string; url: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped timeline JSON
function parseEntries(data: any, handle: string): { tweets: ScrapedTweet[]; cursor: string | null } {
  const instructions =
    data?.user?.result?.timeline_v2?.timeline?.instructions ??
    data?.user?.result?.timeline?.timeline?.instructions ??
    [];
  const tweets: ScrapedTweet[] = [];
  let cursor: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped entries
  const entries: any[] = instructions.flatMap((i: any) => i.entries ?? []);
  for (const e of entries) {
    if (e?.content?.entryType === "TimelineTimelineCursor" && e?.content?.cursorType === "Bottom") {
      cursor = e.content.value;
      continue;
    }
    const r = e?.content?.itemContent?.tweet_results?.result;
    const legacy = r?.legacy ?? r?.tweet?.legacy;
    if (!legacy?.id_str || typeof legacy.full_text !== "string") continue;
    // Skip pure retweets — they are not the account's own call.
    if (legacy.retweeted_status_result || legacy.full_text.startsWith("RT @")) continue;
    tweets.push({
      id_str: legacy.id_str,
      full_text: legacy.full_text,
      created_at: legacy.created_at,
      url: `https://x.com/${handle}/status/${legacy.id_str}`,
    });
  }
  return { tweets, cursor };
}

// Lightweight single-tweet existence check for the on-demand "report deleted"
// flow (cheaper than a cron over every stored tweet). Returns false when X
// reports the tweet gone (empty result or a TweetTombstone), true when it still
// resolves. Throws only on auth/network errors so the caller can distinguish
// "confirmed deleted" from "couldn't check".
const Q_TWEET_BY_ID = "Xl5pC_lBk_gcO2ItU39DQw";
export async function tweetExists(tweetId: string): Promise<boolean> {
  const variables = { tweetId, withCommunity: false, includePromotedContent: false, withVoice: false };
  const data = await graphql(Q_TWEET_BY_ID, "TweetResultByRestId", variables, DEFAULT_FEATURES);
  const result = data?.tweetResult?.result;
  if (!result) return false;
  if (result.__typename === "TweetTombstone" || result.tombstone) return false;
  return true;
}

export async function scrapeTweets(handle: string, limit = 100): Promise<ScrapedTweet[]> {
  const userId = await resolveUserId(handle);
  const out: ScrapedTweet[] = [];
  let cursor: string | null = null;
  let emptyPages = 0;
  while (out.length < limit && emptyPages < 2) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variables bag
    const variables: any = {
      userId,
      count: 20,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) variables.cursor = cursor;
    const data = await graphql(Q_USER_TWEETS, "UserTweets", variables, DEFAULT_FEATURES);
    const { tweets, cursor: next } = parseEntries(data, handle);
    if (tweets.length === 0) emptyPages++;
    else emptyPages = 0;
    out.push(...tweets);
    if (!next || next === cursor) break;
    cursor = next;
    await sleep(1500); // polite pacing between pages
  }
  return out.slice(0, limit);
}

// CLI: <handle> [limit] [outFile]
if (process.argv[1] && process.argv[1].endsWith("scrape-x.ts")) {
  const handle = process.argv[2];
  const limit = parseInt(process.argv[3] ?? "100", 10);
  const outFile = process.argv[4] ?? `./scraped-${handle}.json`;
  if (!handle) {
    console.error("usage: scrape-x.ts <handle> [limit] [outFile]");
    process.exit(1);
  }
  scrapeTweets(handle, limit)
    .then((tweets) => {
      writeFileSync(outFile, JSON.stringify(tweets, null, 2));
      console.log(`scraped ${tweets.length} tweets from @${handle} → ${outFile}`);
    })
    .catch((e) => {
      console.error(`scrape failed: ${e.message}`);
      process.exit(1);
    });
}
