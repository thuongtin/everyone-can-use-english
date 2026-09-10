#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const marker = process.argv[2];
if (marker) appendFileSync(marker, `\n${process.pid}`);
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
