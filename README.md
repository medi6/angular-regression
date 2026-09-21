# Angular >= 22.0.2 — duplicate signal dependency links when an effect writes a signal

Minimal, dependency-free reproduction of a reactivity regression introduced in
**Angular 22.0.2**.

When a reactive consumer (effect, computed, template) **writes a signal** and then
**re-reads** a signal it already depends on, the re-read no longer deduplicates:
a **duplicate dependency link** is created, and the producer ends up registered
with the same consumer twice. Every subsequent notification is therefore emitted
twice, which in a real application multiplies effect executions and change
detection work at startup.

## Reproduction

```js
effect(() => {
  const a = A();
  const c = C();
  B.set(a + c);   // writing a signal inside the effect
  A();            // re-reading A, out of replay order
});
```

`A` must be re-read **after** the write, and **not** immediately after its first
read — the two fast paths in `producerAccessed` cover those two cases.

## Running it

```bash
./run.sh                       # 21.2.5 22.0.0 22.0.1 22.0.2 22.1.7
./run.sh 22.0.1 22.0.2         # a specific subset
./verify-patch.sh 22.1.7       # same version, with and without the patch
```

Each Angular version is installed under `versions/<v>/` (git-ignored).

## Results

| Angular | producer links on the consumer | consumers registered on `A` | verdict |
|---|---|---|---|
| 21.2.5 | 2, 2, 2, 2, 2, 2 | 1 | OK |
| 22.0.0 | 2, 2, 2, 2, 2, 2 | 1 | OK |
| **22.0.1** | 2, 2, 2, 2, 2, 2 | 1 | **OK — last unaffected version** |
| **22.0.2** | 2, **3**, 3, 3, 3, 3 | **2** | **regression** |
| 22.1.7 | 2, **3**, 3, 3, 3, 3 | **2** | regression |
| 22.1.7 + patch | 2, 2, 2, 2, 2, 2 | 1 | OK |

Expected: the dependency set is stable across runs (2 links: `A` and `C`) and `A`
has exactly one registered consumer.

## Root cause

`producerAccessed` deduplicates in three steps. The first two fast paths only
cover an immediate re-read and a replay in the *same* order. The third path —
the one that catches out-of-order re-reads — changed in commit
[`f902d1d35e`](https://github.com/angular/angular/commit/f902d1d35e)
*("perf: detect existing signal dependency without checking all producer
links")*, released in **22.0.2**:

```js
// 22.0.1 — structural check, epoch-independent
... && (!isRecomputing || isValidLink(prevConsumerLink, activeConsumer))

// 22.0.2 — global-counter check
... && (!isRecomputing || prevConsumerLink.knownValidAtEpoch === epoch)
```

`epoch` is a **module-global** counter incremented by **every** signal write
(`signalValueChanged` → `producerIncrementEpoch`) — including the write the
effect itself just performed on `B`. The link to `A` is still perfectly valid,
but its `knownValidAtEpoch` is now behind the global `epoch`, so the guard fails
and a duplicate link is created.

The optimisation is only sound if `epoch` advancing implies the link is stale.
It does not: an unrelated signal write advances `epoch` without invalidating
anything.

## Patch

`angular-core-signal-dedup.patch` restores the 22.0.1 behaviour on
`node_modules/@angular/core/fesm2022/_effect-chunk.mjs`: it reintroduces
`isValidLink` verbatim and switches the guard back to it. The
`knownValidAtEpoch` assignments are left in place (unused, harmless), so the
change is one line plus the restored function.

```bash
patch -N -s node_modules/@angular/core/fesm2022/_effect-chunk.mjs <angular-core-signal-dedup.patch
```
