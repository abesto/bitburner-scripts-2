export function timeout<T>(
  promise: Promise<T>,
  time: number
): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((_r, rej) => {
      setTimeout(rej, time);
    }),
  ]);
}

export async function silentTimeout<T>(
  promise: Promise<T>,
  time: number
): Promise<T | void> {
  try {
    return await timeout(promise, time);
  } catch (e) {
    return;
  }
}
