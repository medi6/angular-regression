/**
 * Reproduction minimale — regression du graphe reactif Angular >= 22.0.2
 *
 * SCENARIO (banal) : un effect lit deux signaux A et C, ecrit un signal B a
 * partir des deux, puis relit A.
 *
 *     effect(() => {
 *       const a = A();
 *       const c = C();
 *       B.set(a + c);     // <-- ecriture d'un signal DANS l'effect
 *       A();              // <-- relecture de A apres l'ecriture
 *     });
 *
 * ATTENDU (= comportement Angular <= 22.0.1) : l'effect porte 2 dependances
 * (A et C), stables, et s'execute une fois par changement de A.
 *
 * OBSERVE a partir d'Angular 22.0.2 : la relecture de A cree un lien de
 * dependance DUPLIQUE a chaque execution. Le nombre de liens croit sans fin,
 * A notifie son consommateur plusieurs fois, et l'effect se re-declenche.
 *
 * CAUSE : `producerAccessed` deduplique en trois temps. Les deux premiers
 * chemins rapides ne couvrent que la relecture immediate et le rejeu dans le
 * MEME ordre. Le troisieme, celui qui rattrape les relectures hors ordre, a
 * change au commit f902d1d35e ("perf: detect existing signal dependency
 * without checking all producer links", livre en 22.0.2) :
 *
 *   22.0.1 :  ... && (!isRecomputing || isValidLink(prevConsumerLink, activeConsumer))
 *   22.0.2 :  ... && (!isRecomputing || prevConsumerLink.knownValidAtEpoch === epoch)
 *
 * `epoch` est un compteur GLOBAL incremente par TOUTE ecriture de signal — y
 * compris celle que l'effect vient de faire sur B. Le lien vers A, pourtant
 * parfaitement valide, est donc juge perime et un doublon est cree.
 */
import {
  createSignal, createWatch, getActiveConsumer,
} from '@angular/core/primitives/signals';
import { createRequire } from 'node:module';

const version = createRequire(import.meta.url)('@angular/core/package.json').version;

/** createSignal renvoie [get, set, update] (>=19) ou un getter (plus ancien). */
function sig(a_init) {
  const l_ret = createSignal(a_init);
  return Array.isArray(l_ret) ? { get: l_ret[0], set: l_ret[1] } : { get: l_ret, set: l_ret.set };
}

/** Nombre de consommateurs (vivants) enregistres sur un producteur. */
function nbConsommateurs(a_producer) {
  let l_n = 0;
  for (let l = a_producer.liveConsumers ?? a_producer.consumers; l !== undefined && l_n <= 10000; l = l.nextConsumer) {
    l_n++;
  }
  return l_n;
}

/** Nombre de liens de dependance portes par un noeud consommateur. */
function nbLiens(a_consumer) {
  if (Array.isArray(a_consumer.producerNode)) {
    return a_consumer.producerNode.length;          // ancienne representation (tableaux)
  }
  let l_n = 0;
  for (let l = a_consumer.producers; l !== undefined && l_n <= 10000; l = l.nextProducer) {
    l_n++;
  }
  return l_n;
}

const A = sig(0);
const noeudA = () => A.get[Object.getOwnPropertySymbols(A.get).find(a_s => String(a_s) === 'Symbol(SIGNAL)')];
const C = sig(0);
const B = sig(0);

let executions = 0;
let notifications = 0;
const liensParRun = [];
let enAttente = false;

const watch = createWatch(
  () => {
    executions++;
    const l_a = A.get();
    const l_c = C.get();
    B.set(l_a + l_c);      // ecriture d'un signal dans l'effect -> epoch++
    A.get();               // relecture hors ordre de rejeu -> doublon a partir de 22.0.2
    liensParRun.push(nbLiens(getActiveConsumer()));
  },
  () => { notifications++; enAttente = true; },
  true,                    // allowSignalWrites
);

// --- 1) execution initiale : les liens sont crees.
watch.run();
const liensApresRunInitial = liensParRun[0];

// --- 2) cinq modifications externes de A, chacune suivie d'une vidange de la
//        file comme le ferait le scheduler d'Angular.
let executionsParChangement = [];
let notificationsParChangement = [];
let tours = 0;
for (let l_i = 1; l_i <= 5; l_i++) {
  const l_avant = executions;
  notifications = 0;
  A.set(l_i);
  let l_t = 0;
  while (enAttente && l_t < 40) {
    enAttente = false;
    l_t++;
    watch.run();
  }
  tours += l_t;
  executionsParChangement.push(executions - l_avant);
  notificationsParChangement.push(notifications);
}

const sain = executionsParChangement.every(a_n => a_n === 1)
  && notificationsParChangement.every(a_n => a_n === 1)
  && liensParRun.every(a_n => a_n === liensApresRunInitial);

console.log(JSON.stringify({
  version,
  liensApresRunInitial,
  executionsParChangementDeA: executionsParChangement,
  liensParExecution: liensParRun.slice(0, 12),
  notificationsParChangementDeA: notificationsParChangement,
  consommateursEnregistresSurA: nbConsommateurs(noeudA()),
  verdict: sain ? 'SAIN' : 'REGRESSION',
}));
