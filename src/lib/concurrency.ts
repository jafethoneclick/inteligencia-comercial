/**
 * Corre `worker` sobre cada item de `items` con un máximo de `limite`
 * ejecuciones en paralelo. A diferencia de Promise.all directo (que lanza
 * todo a la vez), esto evita disparar cientos/miles de llamadas de red
 * simultáneas cuando items.length es grande (ej. 1000 candidatos a validar).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limite: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limite, items.length) }, runOne);
  await Promise.all(workers);
  return results;
}
