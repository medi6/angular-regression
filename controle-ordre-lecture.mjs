/**
 * CONTROLE (pas un repro) — ce qui n'est PAS le declencheur.
 *
 * Hypothese testee : « il suffit que la sequence de lecture varie d'une
 * execution a l'autre pour creer un lien duplique ».
 *
 * Resultat : FAUX. Les chiffres sont RIGOUREUSEMENT IDENTIQUES sur 21.2.5,
 * 22.0.1, 22.0.2 et 22.1.7. Une sequence de lecture variable fait bien bouger
 * le nombre de liens, mais c'est le comportement normal du graphe, present
 * bien avant la regression.
 *
 * Le declencheur exige, en plus, une ECRITURE de signal entre les lectures :
 * c'est elle qui fait avancer `epoch` et invalide a tort la garde de
 * deduplication. Voir repro-vue.mjs et repro-effect.mjs.
 *
 * Ce fichier est conserve pour delimiter le perimetre du bug et eviter qu'on
 * reprenne cette fausse piste.
 */
import { createSignal, createWatch, getActiveConsumer } from '@angular/core/primitives/signals';
import { createRequire } from 'node:module';

const version = createRequire(import.meta.url)('@angular/core/package.json').version;

function sig(a_init) {
  const l_ret = createSignal(a_init);
  return Array.isArray(l_ret) ? { get: l_ret[0], set: l_ret[1] } : { get: l_ret, set: l_ret.set };
}

function nbLiens(a_consumer) {
  if (Array.isArray(a_consumer.producerNode)) { return a_consumer.producerNode.length; }
  let l_n = 0;
  for (let l = a_consumer.producers; l !== undefined && l_n <= 10000; l = l.nextProducer) { l_n++; }
  return l_n;
}

/** Joue un scenario : declencheur `tick`, corps `a_corps`, 6 executions. */
function scenario(a_corps) {
  const tick = sig(0);
  const liens = [];
  let enAttente = false;
  const watch = createWatch(
    () => {
      a_corps(tick.get());
      liens.push(nbLiens(getActiveConsumer()));
    },
    () => { enAttente = true; },
    false,
  );
  watch.run();
  for (let l_i = 1; l_i <= 5; l_i++) {
    tick.set(l_i);
    let l_t = 0;
    while (enAttente && l_t < 40) { enAttente = false; l_t++; watch.run(); }
  }
  watch.destroy();
  return liens;
}

// --- Cas 1 : ordre de lecture inverse une execution sur deux ----------------
const A1 = sig(0), C1 = sig(0);
const cas1 = scenario((a_t) => {
  if (a_t % 2 === 0) { A1.get(); C1.get(); } else { C1.get(); A1.get(); }
});

// --- Cas 2 : lecture conditionnelle au milieu d'une sequence stable ---------
const A2 = sig(0), B2 = sig(0), C2 = sig(0);
const cas2 = scenario((a_t) => {
  A2.get();
  if (a_t % 2 === 0) { B2.get(); }   // lu une fois sur deux
  C2.get();
});

// Pas de verdict : ce fichier sert a comparer les versions entre elles.
// Toutes doivent afficher les MEMES chiffres.
console.log(JSON.stringify({
  version,
  cas1_ordreInverse: cas1,
  cas2_lectureConditionnelle: cas2,
}));
