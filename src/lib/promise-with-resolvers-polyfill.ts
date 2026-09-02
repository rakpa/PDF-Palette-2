/** pdf.js 4+ calls Promise.withResolvers (Safari < 17.4 / older Chromium lack it). */
export function polyfillPromiseWithResolvers(): void {
  const ctor = Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof ctor.withResolvers === "function") return;

  ctor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

polyfillPromiseWithResolvers();
