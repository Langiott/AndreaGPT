import assert from "node:assert/strict";
import { test } from "node:test";
import { createStreamBatch } from "../src/streamBatch";

test("stream shows first token immediately and coalesces subsequent tokens", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const snapshots: string[] = [];
  const batch = createStreamBatch(text => snapshots.push(text));
  batch.append("C");
  batch.append("ia");
  batch.append("o");
  assert.deepEqual(snapshots, ["C"]);
  t.mock.timers.tick(40);
  assert.deepEqual(snapshots, ["C", "Ciao"]);
});

test("completion or interruption flushes pending text and cancels delayed updates", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const snapshots: string[] = [];
  const batch = createStreamBatch(text => snapshots.push(text));
  batch.append("Prima");
  batch.append(" e ultima parte");
  batch.flush();
  batch.flush();
  t.mock.timers.tick(100);
  assert.deepEqual(snapshots, ["Prima", "Prima e ultima parte"]);
});
