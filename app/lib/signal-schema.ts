import { z } from "zod";
// Only `template` and `confidence` are required of the model, so it legitimately
// omits the others on NOT_A_SIGNAL or terse calls. Use `.nullish()` (accepts a
// missing key OR null) and normalize to null so consumers see a clean
// `string | null`, never `undefined`.
export const SignalSchema = z.object({
  template: z.enum(["DIRECTIONAL", "TARGET_CALL", "GEM_SHILL", "NOT_A_SIGNAL"]),
  asset_symbol: z.string().nullish().transform((v) => v ?? null),
  direction: z.enum(["long", "short"]).nullish().transform((v) => v ?? null),
  expiry_days: z.number().nullish().transform((v) => v ?? null),
  confidence: z.number().min(0).max(1),
});
export type Signal = z.infer<typeof SignalSchema>;
export const DEFAULT_EXPIRY: Record<string, number> = { DIRECTIONAL: 7, TARGET_CALL: 30, GEM_SHILL: 30 };
