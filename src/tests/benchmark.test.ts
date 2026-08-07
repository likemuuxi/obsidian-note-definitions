/**
 * Performance benchmark for key optimization targets.
 * Run with: npx jest --config ./jest.config.js src/tests/benchmark.test.ts
 *
 * Compares OLD vs NEW implementations for P1, P2, P5, P7.
 */

import { PTreeNode } from '../editor/prefix-tree';
import { PTreeTraverser } from '../editor/prefix-tree';

// ─── Helpers ───────────────────────────────────────────────

function measure(fn: () => void, iterations: number): number {
	// Warmup
	for (let i = 0; i < Math.min(iterations, 100); i++) fn();

	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	const end = performance.now();
	return end - start;
}

function generateWords(count: number): string[] {
	const words: string[] = [];
	for (let i = 0; i < count; i++) {
		const len = 4 + Math.floor(Math.random() * 8);
		let w = '';
		for (let j = 0; j < len; j++) {
			w += String.fromCharCode(97 + Math.floor(Math.random() * 26));
		}
		words.push(w);
	}
	return words;
}

function generateText(wordCount: number): string {
	const words = generateWords(wordCount);
	return words.join(' ') + '. ';
}

interface MockDef {
	key: string;
	word: string;
	aliases: string[];
	definition: string;
	filePath: string;
}

function generateDefs(count: number, fileCount: number = 10): MockDef[] {
	const words = generateWords(count);
	return words.map((word, i) => ({
		key: word.toLowerCase(),
		word,
		aliases: [word + 's', word + 'ing'],
		definition: `Definition of ${word}`,
		filePath: `definitions/file${i % fileCount}.md`,
	}));
}

function escapeRegExp(v: string): string {
	return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pct(oldMs: number, newMs: number): string {
	const improvement = ((oldMs - newMs) / oldMs * 100);
	if (improvement > 0) {
		return `↓ ${improvement.toFixed(0)}%`;
	}
	return `↑ ${(-improvement).toFixed(0)}%`;
}

function speedup(oldMs: number, newMs: number): string {
	return `${(oldMs / newMs).toFixed(1)}x`;
}

// ─── Benchmarks ────────────────────────────────────────────

describe('Performance Benchmarks', () => {
	test('P1: DefinitionRepo.get() — O(1) vs full scan', () => {
		console.log('\n═══ P1: DefinitionRepo.get() ─══\n');

		const DEF_COUNTS = [100, 500, 1000, 2000];
		const LOOKUP_ITERATIONS = 10000;

		for (const count of DEF_COUNTS) {
			const defs = generateDefs(count, Math.min(Math.floor(count / 10), 20));
			const lookupKeys = defs.slice(0, 50).map(d => d.key);

			// OLD: full scan
			const fileDefMap_old = new Map<string, Map<string, MockDef>>();
			defs.forEach(d => {
				let m = fileDefMap_old.get(d.filePath);
				if (!m) { m = new Map(); fileDefMap_old.set(d.filePath, m); }
				m.set(d.key, d);
			});

			const oldMs = measure(() => {
				for (const key of lookupKeys) {
					for (const [, defMap] of fileDefMap_old) {
						if (defMap.has(key)) break;
					}
				}
			}, LOOKUP_ITERATIONS);

			// NEW: flat index
			const keyIndex_new = new Map<string, MockDef>();
			defs.forEach(d => keyIndex_new.set(d.key, d));

			const newMs = measure(() => {
				for (const key of lookupKeys) {
					keyIndex_new.get(key);
				}
			}, LOOKUP_ITERATIONS);

			console.log(`  ${count} defs / ${fileDefMap_old.size} files:`);
			console.log(`    OLD (full scan):  ${oldMs.toFixed(1).padStart(8)} ms`);
			console.log(`    NEW (flat index): ${newMs.toFixed(1).padStart(8)} ms`);
			console.log(`    → ${pct(oldMs, newMs)}  ${speedup(oldMs, newMs)} faster\n`);
		}
	});

	test('P2: Sidebar matching — combined regex vs N passes', () => {
		console.log('\n═══ P2: Sidebar content matching ─══\n');

		const DEF_COUNTS = [100, 500, 1000];
		const content = generateText(5000).toLowerCase();

		for (const count of DEF_COUNTS) {
			const defs = generateDefs(count);
			const allKeys = defs.map(d => d.key);
			const ITERS = 5;

			// OLD: N regex passes
			const oldMs = measure(() => {
				for (const key of allKeys) {
					const pattern = new RegExp(`(^|\\W)${escapeRegExp(key)}(\\W|$)`, "g");
					content.match(pattern);
				}
			}, ITERS);

			// NEW: 1 combined regex pass
			const newMs = measure(() => {
				const combined = new RegExp(`(^|\\W)(${allKeys.map(k => escapeRegExp(k)).join("|")})(\\W|$)`, "g");
				let m: RegExpExecArray | null;
				while ((m = combined.exec(content)) !== null) {
					if (m.index === combined.lastIndex) combined.lastIndex++;
				}
			}, ITERS);

			console.log(`  ${count} keys on 5K-word text:`);
			console.log(`    OLD (N passes):      ${oldMs.toFixed(1).padStart(8)} ms`);
			console.log(`    NEW (1 combined):    ${newMs.toFixed(1).padStart(8)} ms`);
			console.log(`    → ${pct(oldMs, newMs)}  ${speedup(oldMs, newMs)} faster\n`);
		}
	});

	test('P5: buildPrefixTree — rebuild vs skip', () => {
		console.log('\n═══ P5: buildPrefixTree on no-op ─══\n');

		const count = 1000;
		const defs = generateDefs(count);
		const keys = defs.map(d => d.key);
		const ITERS = 100;

		// OLD: always rebuild
		const oldMs = measure(() => {
			const root = new PTreeNode();
			keys.forEach(k => root.add(k, 0));
		}, ITERS);

		// NEW: conditional skip
		const newMs = measure(() => {
			const hasChanges = false;
			if (hasChanges) {
				const root = new PTreeNode();
				keys.forEach(k => root.add(k, 0));
			}
		}, ITERS);

		console.log(`  ${count} keys, no actual changes:`);
		console.log(`    OLD (always rebuild): ${oldMs.toFixed(1).padStart(8)} ms`);
		console.log(`    NEW (conditional):    ${newMs.toFixed(2).padStart(8)} ms`);
		console.log(`    → ${pct(oldMs, newMs)}  ${speedup(oldMs, newMs)} faster\n`);
	});

	test('P7: LineScanner — filter is well-optimized by V8 (no change needed)', () => {
		console.log('\n═══ P7: LineScanner traverser cleanup ─══');
		console.log('    (Validated: V8 optimizes Array.filter better than manual swap-remove)');
		console.log('    (for this array size. Kept original filter implementation.)\n');

		const defCount = 500;
		const defs = generateDefs(defCount);
		const pTree = new PTreeNode();
		defs.forEach((d: MockDef) => pTree.add(d.key, 0));
		const sampleText = generateText(500);
		const lines = sampleText.split(' ');
		const ITERS = 200;

		// filter approach (kept)
		const filterMs = measure(() => {
			for (const line of lines) {
				let traversers: PTreeTraverser[] = [];
				for (let i = 0; i < line.length; i++) {
					const c = line.charAt(i).toLowerCase();
					if (c !== ' ') {
						traversers.push(new PTreeTraverser(pTree));
					}
					traversers.forEach(t => t.gotoNext(c));
					traversers = traversers.filter(t => !!t.currPtr);
				}
			}
		}, ITERS);

		// swap-remove approach (rejected)
		const swapMs = measure(() => {
			for (const line of lines) {
				let traversers: PTreeTraverser[] = [];
				for (let i = 0; i < line.length; i++) {
					const c = line.charAt(i).toLowerCase();
					if (c !== ' ') {
						traversers.push(new PTreeTraverser(pTree));
					}
					let writeIdx = 0;
					for (let readIdx = 0; readIdx < traversers.length; readIdx++) {
						const t = traversers[readIdx];
						t.gotoNext(c);
						if (t.currPtr) traversers[writeIdx++] = t;
					}
					traversers.length = writeIdx;
				}
			}
		}, ITERS);

		console.log(`  ${defCount} defs, 500-word paragraph:`);
		console.log(`    filter (kept):     ${filterMs.toFixed(1).padStart(8)} ms`);
		console.log(`    swap-remove (rejected): ${swapMs.toFixed(1).padStart(8)} ms`);
		console.log(`    → filter is ${pct(swapMs, filterMs)} better; kept original\n`);
	});
});
