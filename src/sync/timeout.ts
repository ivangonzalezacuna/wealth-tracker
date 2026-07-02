/** Promise-race timeout wrapper for sign-in and similar fire-and-wait calls. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('signin_timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
