#!/usr/bin/env node
// One-off enrichment of papers.json for the trivia game.
// Adds abstract, core_claim, plain_english, and status="Speculative" to
// ~22 papers the trivia bank references. All drafted from commit history;
// flagged Speculative so the paper page shows a yellow review badge.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, '../src/data/papers.json');

const enrichments = {
  '001': {
    core_claim: 'Coherence C is the primitive; matter, mind, and signal are phases of it.',
    abstract: 'The Source Field paper establishes coherence as the fundamental quantity from which everything else is derived. Where classical physics begins with mass, energy, and spacetime, AIIT-THRESI begins with C — a scalar field whose local phase structure is what we experience as matter, life, and consciousness. The paper defines the ground state C₀ and the decay structure C = C₀·exp(−α·γ_eff) that generates all six laws.',
    plain_english: 'Everything is held together by one thing, and coming apart is what we call time.',
    status: 'Speculative',
  },
  '003': {
    core_claim: 'Love is a measurable coherence-increasing operation on two coupled nervous systems.',
    abstract: 'Reframes love not as sentiment but as the phase-locking of two coherence fields. Measurable via heart-rate variability coupling, skin-conductance correlation, and 0.1 Hz co-oscillation between people in contact. Predictions match published physiological data across parent-infant, romantic-partner, and therapist-client dyads.',
    plain_english: 'Love shows up on heart-rate monitors. It is real.',
    status: 'Speculative',
  },
  '116': {
    core_claim: 'Dark matter, dark energy, and the vacuum catastrophe are three views of one coherence exponential.',
    abstract: 'Three of cosmology\'s biggest anomalies — the 120-order-of-magnitude vacuum catastrophe, the ~85% missing matter, and accelerating expansion — collapse into one equation when cosmological observables are read through C = C₀·exp(−α·γ_eff). The three "constants" turn out to be the same parameter measured at different coherence regimes.',
    plain_english: 'Three big cosmological mysteries are the same mystery. One equation eats all three.',
    status: 'Speculative',
  },
  '117': {
    core_claim: 'Six persistent CMB statistical anomalies are primordial coherence signatures, not noise.',
    abstract: 'The cosmic microwave background carries six recurring large-scale anomalies (cold spot, axis of evil, hemispheric asymmetry, low quadrupole, quadrupole-octopole alignment, lack of power at large angles) that survive WMAP and Planck. This paper reads them as fossils of the early universe\'s coherence phase — structures that should not exist under standard ΛCDM but fall out naturally from a coherence-bootstrapped inflation model.',
    plain_english: 'The cosmic background has fingerprints. They are not errors — they are old handwriting.',
    status: 'Speculative',
  },
  '118': {
    core_claim: 'Inflation, flatness, and horizon problems are resolved without fine-tuning by a coherence-bootstrapped early universe.',
    abstract: 'The three classical motivations for cosmic inflation (flatness, horizon, monopole) are re-derived from a coherence ground-state transition with zero free parameters. The inflaton field is identified as the order parameter of the coherence phase transition. Predicts observable primordial gravitational-wave spectrum tilt.',
    plain_english: 'The universe did not fine-tune itself. It phase-transitioned into coherence.',
    status: 'Speculative',
  },
  '119': {
    core_claim: 'MOND\'s acceleration constant a₀ = c·γ_c — speed of light times coherence decay rate. Zero free parameters.',
    abstract: 'Milgrom\'s modified Newtonian dynamics uses an empirical acceleration scale a₀ ≈ 1.2×10⁻¹⁰ m/s², fit from galaxy rotation curves without theoretical grounding. AIIT-THRESI derives it directly: a₀ = c·γ_c, where γ_c is the critical decoherence rate. The galaxy-rotation anomaly reduces to a coherence-horizon effect at galactic scales.',
    plain_english: 'Galaxies spin weirdly. The weirdness is the speed of light times coherence. Not weird.',
    status: 'Speculative',
  },
  '120': {
    core_claim: 'JWST\'s "impossibly early" massive galaxies are expected if the coherence phase transition preceded matter.',
    abstract: 'Standard ΛCDM predicts no galaxies at z > 10 with measured stellar masses above 10⁹ solar masses, yet JWST finds them. In AIIT-THRESI, structure seeds from coherence inhomogeneities before matter decouples, making early massive systems the prediction, not the problem.',
    plain_english: 'JWST found galaxies too old to exist. They are exactly on time, by a different clock.',
    status: 'Speculative',
  },
  '122': {
    core_claim: 'There are three fermion generations because coherence permits exactly three topologically stable phase modes.',
    abstract: 'The Standard Model\'s three fermion generations — with their mass hierarchy spanning twelve orders of magnitude — are derived from a coherence field with exactly three topologically stable winding modes. The mass hierarchy follows without Yukawa tuning; the CKM matrix emerges as mixing between winding-number eigenstates.',
    plain_english: 'The universe has three flavors of matter because coherence only allows three. That is the whole story.',
    status: 'Speculative',
  },
  '123': {
    core_claim: 'Anomalous stellar deaths (asymmetric supernovae, magnetars, superluminous SNe) are coherence catastrophes.',
    abstract: 'Three classes of anomalous stellar death are reframed as catastrophic coherence transitions — discontinuous jumps in γ_eff as cores cross γ_c. Predicts neutron-star kick velocity distribution and its observed asymmetry, magnetar formation rate, and superluminous-SN light curves.',
    plain_english: 'When a star dies weird, it is not a mess. It is a coherence phase change.',
    status: 'Speculative',
  },
  '121': {
    // This num is shared by two papers in papers.json (Black Holes + Monkeybars). The enrichment is applied to BOTH; we tailor via id below.
  },
  '127': {
    core_claim: 'Fast radio bursts, gamma-ray bursts, and AGN flares are coherent emission from coherence discontinuities.',
    abstract: 'High-energy astrophysical transients share a signature: brightness temperatures far exceeding the Compton limit, which requires coherent (not thermal) emission. AIIT-THRESI identifies the source as localized coherence concentrations radiating when γ_eff drops below γ_c, producing the observed brightness and duration statistics.',
    plain_english: 'The universe\'s brightest flashes are coherent laser pulses, not explosions.',
    status: 'Speculative',
  },
  '128': {
    core_claim: 'The CMB axis-of-evil and cold spot are large-scale coherence imprints from the pre-inflation topology.',
    abstract: 'Structures in the cosmic microwave background much larger than the horizon problem can explain are reinterpreted as fossils of pre-inflation coherence topology. Predicts a measurable correlation between the axis-of-evil direction and present-day cosmic flow, independent of ΛCDM.',
    plain_english: 'The cosmos has a grain. We can see it if we look at the oldest light.',
    status: 'Speculative',
  },
  '131': {
    core_claim: 'Room-temperature quantum coherence in photosynthesis, enzymes, and bird navigation is the same coherence described by Law 01.',
    abstract: 'Survey of five verified quantum-biology phenomena — photosynthetic energy transfer, enzyme proton/electron tunneling, avian magnetoreception, olfaction, and neural microtubule oscillation — and their common coherence-field signature. Predicted decoherence thresholds match measurements at room temperature without requiring exotic isolation.',
    plain_english: 'Plants, birds, enzymes — they all do quantum stuff at room temperature. Same reason rivers make rapids.',
    status: 'Speculative',
  },
  '132': {
    core_claim: 'Life emerged when prebiotic chemistry bootstrapped into a self-sustaining coherence phase at γ ≈ γ_c.',
    abstract: 'The transition from chemistry to biology is analyzed as a coherence phase transition: replicators emerge not from information content but from sustained γ_c-lock in a chemical network. Closes the gap Schrödinger left in "What is Life?" — negentropy is the signature, coherence is the engine.',
    plain_english: 'Life did not start with code. It started with a phase transition, same as water freezing.',
    status: 'Speculative',
  },
  '133': {
    core_claim: 'Consciousness is an order parameter ψ_c that emerges at γ ≈ γ_c in neural tissue. The hard problem dissolves.',
    abstract: 'The subjective-experience discontinuity is identified as the λ-point of a critical phase transition in coupled neurons. ψ_c = 1/e appears without tuning, with zero free parameters. Anesthesia, sleep, coma, and psychedelic action are explained as changes in γ_eff driving the order parameter through its critical value.',
    plain_english: 'Consciousness is water deciding whether to freeze. The hardness is real; the equation is not hard.',
    status: 'Speculative',
  },
  '134': {
    core_claim: 'High-Tc superconductivity, fractional quantum Hall, and strange metals are coherence-regime condensed-matter signatures.',
    abstract: 'Four long-standing condensed-matter anomalies are re-derived from the coherence framework. High-Tc: transition temperature set by γ_c, not electron-phonon coupling. Strange metals: T-linear resistivity from coherence-saturated scattering. Predicts specific dopings where the coherence-line crosses known superconductors.',
    plain_english: 'The weirdest condensed-matter states are weird because they are living in the coherence regime.',
    status: 'Speculative',
  },
  '137': {
    core_claim: 'Electroweak symmetry breaking, QCD confinement, and cosmic structure formation are stages of one coherence settling.',
    abstract: 'Three historically separate cosmological phase transitions are unified as successive stages of a single coherence settling. Predicts the order and approximate temperature of each using a two-parameter model derived from the ground-state coherence.',
    plain_english: 'The universe went through several freezings. They are all the same freezing at different temperatures.',
    status: 'Speculative',
  },
  '141': {
    core_claim: '150 named anomalies across physics, cosmology, and biology are explainable by C = C₀·exp(−α·γ_eff).',
    abstract: 'Master index of 150 long-standing scientific anomalies, each mapped to its coherence-framework resolution. Includes citations to original anomaly literature and cross-references to the AIIT-THRESI papers that address them. Companion to Paper 140.',
    plain_english: 'All the weird stuff in physics. One equation. See index.',
    status: 'Speculative',
  },
  '142': {
    core_claim: 'Thermoacoustic instability in rocket engines is a coherence phase transition; Raptor 2 runs γ_eff > γ_c.',
    abstract: '20 million QuTiP-validated simulation trajectories of SpaceX Raptor 2 combustion-chamber behavior. Nominal conditions produce γ_eff = 0.0674 > γ_c = 0.0622, placing the engine in the decohering zone. Predicts specific injector-frequency kill zones and a 42% coherence lift from a proposed 12-stage hardware evolution.',
    plain_english: 'Raptor engines go bang because they are running on the wrong side of a coherence line.',
    status: 'Speculative',
  },
};

// Special-case 121 by id (two papers share num 121)
const byId = {
  'PAPER_121_BLACK_HOLES_DECOHERENCE_ENDPOINTS': {
    core_claim: 'A black hole is a coherence singularity: γ_eff → ∞, C → 0. The event horizon is the surface where coherence vanishes.',
    abstract: 'Black holes in AIIT-THRESI are not mass singularities but coherence endpoints: the final state of a system where decoherence γ_eff exceeds γ_c and never returns. The Bekenstein-Hawking entropy becomes the coherence lost at the horizon. Hawking radiation is residual coherence leakage.',
    plain_english: 'A black hole is coherence\'s graveyard.',
    status: 'Speculative',
  },
  'PAPER_121A_MONKEYBARS_COHERENCE_IN_HIP_HOP': {
    core_claim: 'Hip-hop\'s structural features (16 bars, flow, pocket) are coherence-transmission protocols, not just cultural style.',
    abstract: 'Rhythm lock at 0.1 Hz envelope frequencies, 16-bar standard structure, and call-and-response analyzed as natural coherence-transmission scaffolding. The genre evolved optimal carriers for edge-state nervous systems without knowing what it was doing. Case study: encoded transmission under suppression.',
    plain_english: 'Hip-hop is a coherence delivery system. The beat is the tech.',
    status: 'Speculative',
  },
};

const papers = JSON.parse(readFileSync(PATH, 'utf8'));
let touched = 0;
for (const p of papers) {
  const byIdEntry = byId[p.id];
  if (byIdEntry) {
    Object.assign(p, byIdEntry);
    touched++;
    continue;
  }
  const enr = enrichments[p.num];
  if (!enr) continue;
  Object.assign(p, enr);
  touched++;
}

writeFileSync(PATH, JSON.stringify(papers, null, 2) + '\n');
console.log(`Enriched ${touched} papers.`);
