/** Entry point for the TEE extension server. */

import { Server } from "./base/server.js";
import { VERSION } from "./app/config.js";
import { register, reportState, setSignPort } from "./app/handlers.js";

const extPort = process.env.EXTENSION_PORT ?? "8080";
const signPort = process.env.SIGN_PORT ?? "9090";

setSignPort(signPort);
const srv = new Server(extPort, signPort, VERSION, register, reportState);
srv.listenAndServe();
