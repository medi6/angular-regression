<!-- Texte pret a coller sur https://github.com/angular/angular/issues/new (bug report) -->

**Which @angular/* package(s) are the source of the bug?**
core

**Is this a regression?**
Yes — the previous version in which this bug was not present was **22.0.1**.

**Description**

Since 22.0.2, a reactive consumer that **writes a signal** and then **re-reads** a
signal it already depends on creates a **duplicate dependency link**. The producer
ends up registered twice with the same consumer, so every later change notifies it
twice.

```js
effect(() => {
  const a = A();
  const c = C();
  B.set(a + c);   // writing a signal inside the effect
  A();            // re-reading A, out of replay order  ->  duplicate link
});
```

`A` must be re-read **after** the write and **not** immediately after its first read,
otherwise one of the two fast paths in `producerAccessed` absorbs it.

Measured with `@angular/core/primitives/signals` (`createWatch`), counting the
consumer's producer links and the producers' registered consumers after five
external changes of `A`:

| Angular | producer links per run | consumers registered on `A` |
|---|---|---|
| 21.2.5 | 2, 2, 2, 2, 2, 2 | 1 |
| 22.0.0 | 2, 2, 2, 2, 2, 2 | 1 |
| 22.0.1 | 2, 2, 2, 2, 2, 2 | 1 |
| **22.0.2** | 2, **3**, 3, 3, 3, 3 | **2** |
| 22.1.7 | 2, **3**, 3, 3, 3, 3 | **2** |

In a real application the effect is reached through change detection rather than a
trivial scheduler, and the duplicate notifications compound: on a medium-sized app
we measured an effect body running **24 times instead of once** on first page load,
with a very visible startup slowdown. Reverting the guard below brings it back to 1.

**Root cause**

`producerAccessed` deduplicates in three steps. The two fast paths cover only an
immediate re-read and a replay in the same order. The third path — the one that
catches out-of-order re-reads — changed in
[`f902d1d35e`](https://github.com/angular/angular/commit/f902d1d35e)
("perf: detect existing signal dependency without checking all producer links"),
released in 22.0.2:

```js
// 22.0.1
... && (!isRecomputing || isValidLink(prevConsumerLink, activeConsumer))

// 22.0.2
... && (!isRecomputing || prevConsumerLink.knownValidAtEpoch === epoch)
```

`epoch` is a module-global counter incremented by **every** signal write
(`signalValueChanged` → `producerIncrementEpoch`), including the write the consumer
itself just performed. The link is still valid, but its `knownValidAtEpoch` is behind
the global `epoch`, the guard fails, and a duplicate link is created.

The optimisation assumes that `epoch` advancing implies the link may be stale. An
unrelated signal write advances `epoch` without invalidating any link, so the
assumption does not hold for consumers that write signals.

**Please provide a link to a minimal reproduction of the bug**

<!-- lien du depot une fois pousse -->

**Please provide the exception or error you saw**

No exception — silent over-execution of effects and extra change detection work.

**Please provide the environment you discovered this bug in**

Angular CLI 22.1.8, Angular 22.1.7, Node 22.16.0, TypeScript 6.0.3, zone.js-based
change detection.
