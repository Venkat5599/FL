/** Infrastructure HTTP server for the TEE extension framework. */

import http from "node:http";
import {
  type Action,
  type ActionResult,
  type DataFixed,
  type RegisterFunc,
  type ReportStateFunc,
  type StateResponse,
  Framework,
  bytes32HexToString,
  versionToHex,
} from "./types.js";
import { hexToBytes } from "./encoding.js";

export class Server {
  readonly extPort: string;
  readonly signPort: string;
  readonly version: string;
  readonly versionHex: string;
  readonly framework: Framework;
  readonly reportState: ReportStateFunc;
  private server: http.Server | null = null;

  // Serialize handler calls via a promise chain.
  private handlerQueue: Promise<void> = Promise.resolve();

  constructor(
    extPort: string,
    signPort: string,
    version: string,
    register: RegisterFunc,
    reportState: ReportStateFunc
  ) {
    this.extPort = extPort;
    this.signPort = signPort;
    this.version = version;
    this.versionHex = versionToHex(version);
    this.framework = new Framework();
    this.reportState = reportState;
    register(this.framework);
  }

  /** Start the HTTP server (returns a promise that resolves when listening). */
  listenAndServe(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.listen(parseInt(this.extPort), () => {
        console.log(`extension listening on port ${this.extPort}`);
        resolve();
      });
    });
  }

  /** Close the HTTP server. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Process a request directly (for testing).
   * Returns [statusCode, responseBody].
   */
  async handleRequestDirect(
    method: string,
    path: string,
    body: string
  ): Promise<[number, unknown]> {
    if (method === "POST" && path === "/action") {
      return this.processAction(body);
    } else if (method === "GET" && path === "/state") {
      return this.processState();
    } else if (method === "GET" && path === "/action") {
      return [405, { error: "method not allowed" }];
    } else if (method === "POST" && path === "/state") {
      return [405, { error: "method not allowed" }];
    }
    return [404, { error: "not found" }];
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === "POST" && req.url === "/action") {
      this.readBody(req).then(
        (body) =>
          this.processAction(body).then(([status, data]) =>
            this.sendJson(res, status, data)
          ),
        () => this.sendJson(res, 400, { error: "failed to read body" })
      );
    } else if (req.method === "GET" && req.url === "/state") {
      this.processState().then(([status, data]) =>
        this.sendJson(res, status, data)
      );
    } else if (
      (req.method === "GET" && req.url === "/action") ||
      (req.method === "POST" && req.url === "/state")
    ) {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("method not allowed");
    } else {
      res.writeHead(501, { "Content-Type": "text/plain" });
      res.end("unsupported op type");
    }
  }

  private async processAction(body: string): Promise<[number, unknown]> {
    let action: Action;
    try {
      action = JSON.parse(body);
    } catch {
      return [400, { error: "invalid action JSON" }];
    }

    let msgBytes: Uint8Array;
    try {
      msgBytes = hexToBytes(action.data.message);
    } catch {
      return [400, { error: "invalid hex in message" }];
    }

    let df: DataFixed;
    try {
      df = JSON.parse(Buffer.from(msgBytes).toString("utf-8"));
    } catch {
      return [400, { error: "invalid DataFixed JSON in message" }];
    }

    const handler = this.framework.lookup(df.opType, df.opCommand);
    if (!handler) {
      return [501, "unsupported op type"];
    }

    // Serialize handler calls.
    let data: string | null;
    let status: number;
    let err: string | null;

    const resultPromise = new Promise<[string | null, number, string | null]>(
      (resolve) => {
        this.handlerQueue = this.handlerQueue.then(async () => {
          const result = await handler(df.originalMessage ?? "");
          resolve(result);
        });
      }
    );

    [data, status, err] = await resultPromise;

    const result: ActionResult = {
      id: action.data.id,
      submissionTag: action.data.submissionTag,
      opType: df.opType,
      opCommand: df.opCommand,
      version: this.versionHex,
      status,
      data: data ?? undefined,
    };

    if (status === 0) {
      result.log = err ? `error: ${err}` : "error: unknown";
    } else if (status === 1) {
      result.log = "ok";
    } else {
      result.log = "pending";
    }

    console.log(
      `action ${action.data.id}: opType=${bytes32HexToString(df.opType)} opCommand=${bytes32HexToString(df.opCommand)} status=${status}`
    );

    return [200, result];
  }

  private async processState(): Promise<[number, unknown]> {
    // State reads are serialized too.
    let stateData: unknown;
    const resultPromise = new Promise<unknown>((resolve) => {
      this.handlerQueue = this.handlerQueue.then(() => {
        resolve(this.reportState());
      });
    });
    stateData = await resultPromise;

    const resp: StateResponse = {
      stateVersion: this.versionHex,
      state: stateData,
    };
    return [200, resp];
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown
  ): void {
    if (typeof data === "string") {
      res.writeHead(status, { "Content-Type": "text/plain" });
      res.end(data);
    } else {
      const body = JSON.stringify(data);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    }
  }
}
