<!-- Texte pret a coller sur https://github.com/angular/angular/issues/new (bug report) -->

**Which @angular/* package(s) are the source of the bug?**
core

**Is this a regression?**
Yes — the previous version in which this bug was not present was **22.0.1**.

**Description**

Since 22.0.2, a reactive consumer that **re-reads** a signal it already depends on
creates a **duplicate dependency link** whenever a signal was written in between.
The producer ends up registered several times with the same consumer, so a single
change notifies that consumer several times.

This hits ordinary component templates, because a view is itself a reactive
consumer and both halves of the trigger are supplied by the framework:

* templates read the same signals many times, interleaved, in an order that
  varies with `@if` / `@for`;
* Angular writes **child component inputs** in between
  (`applyValueToInputSignal` → `signalSetFn` → `producerIncrementEpoch`).

So within a *single* template pass:

```
read config()          -> link validated at epoch = E
child input binding    -> input write                -> epoch = E+1
read config() again    -> guard fails (E !== E+1)    -> duplicate link
```

A real template from a component library reads `config()` 15 times and `data()`
5 times with child bindings throughout. Reproducing that shape with
`@angular/core/primitives/signals` (`createWatch`), and counting the consumer's
producer links plus the consumers registered on each producer:

| Angular | links per run | notifications for one `config` change |
|---|---|---|
| 21.2.5 | 2, 2, 2, 2, 2, 2 | 1 |
| 22.0.0 | 2, 2, 2, 2, 2, 2 | 1 |
| 22.0.1 | 2, 2, 2, 2, 2, 2 | 1 |
| **22.0.2** | **11**, 11, 11, 11, 11, 11 | **6** |
| 22.1.7 | **11**, 11, 11, 11, 11, 11 | **6** |

Expected on all versions: 2 links, 1 notification.

Each extra notification is an extra change detection pass, which re-runs the
view's effects. On a medium-sized application we measured an effect body running
**24 times instead of once** on first page load, with a very visible startup
slowdown. Restoring the 22.0.1 guard brings it back to 1.

The symptom is limited to the first render, which the mechanism predicts:
`signalSetFn` increments `epoch` only when a value **actually changes**. On first
render every binding goes from `undefined` to a value, so `epoch` moves
constantly in the middle of template passes. Once the screen is stable, bindings
stop changing, `epoch` stops moving mid-pass, and no further duplicates appear.

There is no application-level workaround: neither the repeated reads nor the
input writes are written by the application.

**Root cause**

`producerAccessed` deduplicates in three steps. The two fast paths cover only an
immediate re-read of the same producer, and a replay in the same order. The third
path — the one that catches re-reads arriving at a different position — changed in
[`f902d1d35e`](https://github.com/angular/angular/commit/f902d1d35e)
("perf: detect existing signal dependency without checking all producer links"),
released in 22.0.2:

```js
// 22.0.1
... && (!isRecomputing || isValidLink(prevConsumerLink, activeConsumer))

// 22.0.2
... && (!isRecomputing || prevConsumerLink.knownValidAtEpoch === epoch)
```

`epoch` is a module-global counter incremented by **every** signal write. The link
being checked is still valid; it is merely older than an unrelated write. The
optimisation is sound only if `epoch` advancing implies the link may be stale, and
that does not hold for any computation during which a signal is written — which,
for a view, is the normal case.

**Please provide a link to a minimal reproduction of the bug**

https://github.com/medi6/angular-regression.git

`repro-vue.mjs` (view-shaped consumer) and `repro-effect.mjs` (effect writing a
signal). No DOM, no browser, no test runner — only
`@angular/core/primitives/signals`. `./run.sh` installs each Angular version side
by side and prints the table above.

**Please provide the exception or error you saw**

No exception — silent over-notification of views, extra change detection passes,
and effects running several times per change.

**Please provide the environment you discovered this bug in**

Angular CLI 22.1.8, Angular 22.1.7, Node 22.16.0, TypeScript 6.0.3, zone.js-based
change detection.
