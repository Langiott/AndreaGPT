/** Publish the first token immediately, then coalesce bursts into snapshots. */
export function createStreamBatch(publish: (text: string) => void, delayMs = 40) {
  let text = "";
  let published = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (text === published) return;
    published = text;
    publish(text);
  }
  return {
    append(token: string) {
      text += token;
      if (!published) flush();
      else if (timer === undefined) timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
