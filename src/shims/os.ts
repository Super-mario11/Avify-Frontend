export function cpus() {
  const count = navigator.hardwareConcurrency || 4;
  return new Array(count).fill({ model: 'browser' });
}
