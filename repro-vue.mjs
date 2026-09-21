/**
 * Repro n°2 — le cas reel : la VUE est le consommateur.
 *
 * Un template Angular lit les memes signaux de nombreuses fois, entremeles, et
 * Angular ecrit les inputs des composants enfants AU MILIEU de ces lectures
 * (applyValueToInputSignal -> signalSetFn -> epoch++).
 *
 * On simule ici un template qui, comme
 * mc2-basic-summary-component.component.html, lit `config` 15 fois et `data`
 * 5 fois, avec un binding vers un composant enfant entre chaque groupe de
 * lectures.
 *
 *     @if (config()?.x) { <enfant [valeur]="..."> }   -> ecriture d'input
 *     @for (item of data()) { ... config()?.y ... }   -> relecture de config
 *
 * Ni la relecture ni l'ecriture ne viennent du code applicatif : les lectures
 * viennent du template, les ecritures viennent du framework.
 *
 * A partir de 22.0.2, CHAQUE relecture situee apres une ecriture cree un lien
 * duplique. La vue finit enregistree N fois comme consommatrice de `config`,
 * et recoit donc N notifications pour un seul changement.
 *
 * Note : `epoch` n'avance que si une ecriture change REELLEMENT la valeur
 * (signalSetFn teste node.equal). D'ou le fait que le probleme ne se manifeste
 * qu'au PREMIER rendu, quand tous les bindings passent de undefined a une
 * valeur. Une fois l'ecran stabilise, plus aucune ecriture ne bouge epoch
 * pendant la passe de template, et les doublons cessent.
 */
import { createSignal, createWatch, getActiveConsumer } from '@angular/core/primitives/signals';
import { createRequire } from 'node:module';

const version = createRequire(import.meta.url)('@angular/core/package.json').version;

function sig(a_init) {
  const l_ret = createSignal(a_init);
  return Array.isArray(l_ret) ? { get: l_ret[0], set: l_ret[1] } : { get: l_ret, set: l_ret.set };
}
const noeud = (a_sig) => a_sig.get[Object.getOwnPropertySymbols(a_sig.get)
  .find(a_s => String(a_s) === 'Symbol(SIGNAL)')];

function nbLiens(a_consumer) {
  if (Array.isArray(a_consumer.producerNode)) { return a_consumer.producerNode.length; }
  let l_n = 0;
  for (let l = a_consumer.producers; l !== undefined && l_n <= 10000; l = l.nextProducer) { l_n++; }
  return l_n;
}
function nbConsommateurs(a_producer) {
  let l_n = 0;
  for (let l = a_producer.liveConsumers ?? a_producer.consumers; l !== undefined && l_n <= 10000; l = l.nextConsumer) { l_n++; }
  return l_n;
}

const LECTURES_CONFIG = 15;   // mc2-basic-summary-component.component.html
const LECTURES_DATA = 5;

const config = sig({ v: 0 });
const data = sig([]);
// inputs des composants enfants, ecrits par Angular pendant la passe de template
const inputsEnfants = Array.from({ length: LECTURES_CONFIG }, () => sig(undefined));

let executions = 0;
const liensParRun = [];
let enAttente = false;

const vue = createWatch(
  () => {
    executions++;
    for (let l_i = 0; l_i < LECTURES_CONFIG; l_i++) {
      config.get();
      if (l_i < LECTURES_DATA) { data.get(); }
      // binding vers un enfant : Angular ecrit l'input -> epoch++
      inputsEnfants[l_i].set(`${executions}-${l_i}`);
    }
    liensParRun.push(nbLiens(getActiveConsumer()));
  },
  () => { enAttente = true; },
  true,
);

vue.run();
for (let l_i = 1; l_i <= 5; l_i++) {
  config.set({ v: l_i });
  let l_t = 0;
  while (enAttente && l_t < 40) { enAttente = false; l_t++; vue.run(); }
}

// attendu : 2 liens (config et data) et 1 seule notification par producteur.
const consoConfig = nbConsommateurs(noeud(config));
const consoData = nbConsommateurs(noeud(data));
const sain = liensParRun.every(a_n => a_n === 2) && (consoConfig === 1) && (consoData === 1);
console.log(JSON.stringify({
  version,
  liensParExecution: liensParRun,
  notificationsRecuesParLaVuePourUnChangementDeConfig: consoConfig,
  notificationsRecuesParLaVuePourUnChangementDeData: consoData,
  verdict: sain ? 'SAIN' : 'REGRESSION',
}));
