/**
 * Returns a debounced version of the given function.
 * The returned function delays invocation until `delay` ms have elapsed
 * since the last call. Each call resets the timer.
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return ((...args: any[]) => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => fn(...args), delay);
	}) as T;
}
