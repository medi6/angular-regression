# Angular >= 22.0.2 — duplicate dependency links when a signal is written mid-computation

Minimal, DOM-free reproduction of a reactivity regression introduced in
**Angular 22.0.2**.

When a reactive consumer **re-reads** a signal it already depends on, and a
signal was **written** in between, the re-read no longer deduplicates: a
**duplicate dependency link** is created. The producer ends up registered
several times with the same consumer, so a single change notifies that consumer
several times.

The consumer that matters in practice is **the view**, not an effect — see below.

## Why ordinary components are affected

A component template reads the same signals many times, interleaved, and Angular
writes **child component inputs** in between (`applyValueToInputSignal` →
`signalSetFn` → `epoch++`). Neither half comes from application code.

A real example from a component library — `mc2-basic-summary-component.component.html`
reads `config()` **15 times** and `data()` 5 times, with child bindings
throughout. Within a *single* template pass:

```
read config()          -> link validated at epoch = E
child input binding    -> input write                -> epoch = E+1
read config() again    -> guard fails (E !== E+1)    -> DUPLICATE LINK
```

`repro-vue.mjs` reproduces exactly that shape. On 22.1.7 the view ends up with
**11 dependency links instead of 2**, and receives **6 notifications instead of 1**
for a single change of `config`. Each extra notification is an extra change
detection pass, which re-runs the view's effects.

## Why it only shows on the first render

`signalSetFn` increments `epoch` only when the value **actually changes**
(`node.equal`). On first render every binding goes from `undefined` to a value,
so `epoch` moves constantly in the middle of template passes and duplicates pile
up everywhere. Once the screen is stable, bindings stop changing, `epoch` stops
moving mid-pass, the guard passes, and no further duplicates appear.

## Running it

```bash
./run.sh                       # 21.2.5 22.0.0 22.0.1 22.0.2 22.1.7
./run.sh 22.0.1 22.0.2         # a specific subset
./verify-patch.sh 22.1.7       # same version, with and without the patch
```

Each Angular version is installed under `versions/<v>/` (git-ignored). Only
`@angular/core/primitives/signals` is used: no DOM, no browser, no test runner.

| file | what it shows |
|---|---|
| `repro-vue.mjs` | the real-world case: a view-shaped consumer. **Start here.** |
| `repro-effect.mjs` | the same defect in an effect that writes a signal |
| `controle-ordre-lecture.mjs` | control: a varying read order alone is *not* the trigger (all versions agree) |

## Results

`repro-vue.mjs`, expected `2` links and `1` notification per producer:

| Angular | links per run | notifications for one `config` change | verdict |
|---|---|---|---|
| 21.2.5 | 2, 2, 2, 2, 2, 2 | 1 | OK |
| 22.0.0 | 2, 2, 2, 2, 2, 2 | 1 | OK |
| **22.0.1** | 2, 2, 2, 2, 2, 2 | 1 | **OK — last unaffected version** |
| **22.0.2** | **11**, 11, 11, 11, 11, 11 | **6** | **regression** |
| 22.1.7 | **11**, 11, 11, 11, 11, 11 | **6** | regression |
| 22.1.7 + patch | 2, 2, 2, 2, 2, 2 | 1 | OK |

## Root cause

`producerAccessed` deduplicates in three steps. The two fast paths cover only an
immediate re-read of the same producer, and a replay in the *same* order. The
third path — the one that catches re-reads arriving at a different position —
changed in commit
[`f902d1d35e`](https://github.com/angular/angular/commit/f902d1d35e)
*("perf: detect existing signal dependency without checking all producer links")*,
released in **22.0.2**:

```js
// 22.0.1 — structural check, epoch-independent
... && (!isRecomputing || isValidLink(prevConsumerLink, activeConsumer))

// 22.0.2 — global-counter check
... && (!isRecomputing || prevConsumerLink.knownValidAtEpoch === epoch)
```

`epoch` is a **module-global** counter incremented by **every** signal write
(`signalValueChanged` → `producerIncrementEpoch`). The link being checked is
still perfectly valid; it is merely older than an unrelated write. The
optimisation is sound only if `epoch` advancing implies the link is stale, and
that does not hold for any computation during which a signal is written —
which, for a view, is the normal case.

## Patch

`angular-core-signal-dedup.patch` restores the 22.0.1 behaviour on
`node_modules/@angular/core/fesm2022/_effect-chunk.mjs`: it reintroduces
`isValidLink` verbatim and switches the guard back to it.

```bash
patch -N -s node_modules/@angular/core/fesm2022/_effect-chunk.mjs <angular-core-signal-dedup.patch
```

The remaining `knownValidAtEpoch` assignments are left untouched. The other site
that reads the field, `resetConsumerBeforeComputation`, only clears it; with the
guard restored nothing reads it for deduplication any more, so that code becomes
inert rather than incorrect.
