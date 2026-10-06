export default async function globalTeardown(): Promise<void> {
  const pg = (globalThis as any).__PG_CONTAINER__;
  if (pg) await pg.stop();
}
