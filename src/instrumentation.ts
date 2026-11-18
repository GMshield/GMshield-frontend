// Runs once when the server starts, before it serves anything.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkStartup } = await import('@/server/startup');
    checkStartup();
  }
}
