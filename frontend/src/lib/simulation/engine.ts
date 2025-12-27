import type { Issue, District, Bill, SimResponse, Round, Vote, Speech } from "../api";
import { type Member, decideVote } from "./agents";
import { generateSpeech } from "./debate";
import { Random } from "./rng";

export interface SimulationResult {
  members: number;
  rounds: Round[];
  final_passed: boolean;
}

function sampleMembers(districts: District[], n: number, rng: Random): Member[] {
  // Weight by population
  const pops = districts.map(d => Math.max(1, d.population));
  const total = pops.reduce((a, b) => a + b, 0);
  const probs = pops.map(p => p / total);

  const members: Member[] = [];
  for (let i = 0; i < n; i++) {
    const d = rng.choice(districts, probs);
    // ideology roughly tracks district lean but with noise
    let ideology = rng.gauss(d.lean, 0.35);
    ideology = Math.max(-1.0, Math.min(1.0, ideology));

    // cosmetic party hint
    const partyHint = ideology > 0.15 ? "Blue" : (ideology < -0.15 ? "Red" : "Purple");

    members.push({
      member_id: `M-${String(i + 1).padStart(4, '0')}`,
      district: d,
      ideology,
      party_hint: partyHint
    });
  }
  return members;
}

function pickSpokespeople(members: Member[], k: number = 7): Member[] {
  const sortedM = [...members].sort((a, b) => a.ideology - b.ideology);
  if (sortedM.length <= k) return sortedM;

  // Pick representative slice: min, 25%, median, 75%, max
  const len = sortedM.length;
  const idxs = [0, Math.floor(len / 4), Math.floor(len / 2), Math.floor(3 * len / 4), len - 1];

  const chosen: Member[] = [];
  const seen = new Set<string>();

  for (const i of idxs) {
    const m = sortedM[i];
    if (!seen.has(m.member_id)) {
      chosen.push(m);
      seen.add(m.member_id);
    }
  }

  // Fill rest from middle 50% randomly
  const midStart = Math.floor(len / 4);
  const midEnd = Math.floor(3 * len / 4);
  const mid = sortedM.slice(midStart, midEnd);

  while (chosen.length < k && mid.length > 0) {
    const randIdx = Math.floor(Math.random() * mid.length);
    const m = mid[randIdx];
    if (!seen.has(m.member_id)) {
      chosen.push(m);
      seen.add(m.member_id);
    }
    // simple avoid infinite loop if all taken
    if (chosen.length < k && seen.size >= members.length) break;
  }

  return chosen.sort((a, b) => a.ideology - b.ideology);
}


// Helper for sequential async to avoid swamping local LLM
async function asyncVote(members: Member[], bill: Bill, useLlm: boolean, llmModel: string, threshold: number = 0.5): Promise<Vote> {
  let yes = 0, no = 0, abstain = 0;

  // We can process in chunks to be faster but safe
  // For now simple serial for stability
  for (const m of members) {
    const decision = await decideVote(m, bill, useLlm, llmModel);
    if (decision.vote === "yes") yes++;
    else if (decision.vote === "no") no++;
    else abstain++;
  }

  const passed = (yes / Math.max(1, yes + no)) >= threshold;
  return { yes, no, abstain, passed, threshold };
}

// Deprecated amendment logic for now
// function proposeAmendment(...) ...

export async function runSimulation(
  districts: District[],
  numMembers: number,
  rounds: number,
  bill: Bill, // CHANGED from issueVector
  useLlm: boolean,
  llmModel: string,
  seed: number | null
): Promise<SimulationResult> {
  const rng = new Random(seed);
  if (!districts || districts.length === 0) {
    throw new Error("No active districts are loaded.");
  }

  const members = sampleMembers(districts, numMembers, rng);
  // let currentIssues = { ...issueVector }; // Deleted
  let currentBill = bill; // In future we could amend the bill text
  const allRounds: Round[] = [];

  for (let r = 0; r < rounds; r++) {
    const spokes = pickSpokespeople(members, 7);
    const speeches: Speech[] = [];

    // Generate speeches
    for (const s of spokes) {
      // Calculate stance via LLM too?
      // For speed, let's reuse decision logic or separate?
      // Ideally speech generation implies a stance.
      // Let's call decideVote first.
      const decision = await decideVote(s, currentBill, useLlm, llmModel);

      let stance: "support" | "oppose" | "amend" = "amend";
      if (decision.vote === "yes") stance = "support";
      if (decision.vote === "no") stance = "oppose";

      // We pass a dummy issue vector or update generateSpeech to take Bill
      // TODO: Update generateSpeech signature next. 
      // For now passing empty dict to satisfy type if not changed yet, but I should update debate.ts too.
      // Actually I will update debate.ts in next step.
      // I'll assume generateSpeech signature is updated to take Bill.
      const txt = await generateSpeech(s, stance, currentBill, useLlm, llmModel);

      speeches.push({
        member_id: s.member_id,
        stance,
        text: txt,
        rationale: {} // No mathematical rationale anymore
      });
    }

    const voteResult = await asyncVote(members, currentBill, useLlm, llmModel, 0.5);
    allRounds.push({
      round_index: r,
      speeches,
      vote: voteResult
    });

    // If failed and rounds remain, we technically stop or amend.
    // Without amendment logic, we just stop if passed or fail?
    // User requested realistic logic.
    // If it fails, it fails.
    if (voteResult.passed) break;

    // If not passed, we loop? But result will be same without amendment.
    // So let's break to avoid duplicate rounds.
    if (!voteResult.passed) break;
  }

  const finalPassed = allRounds.length ? allRounds[allRounds.length - 1].vote.passed : false;
  return {
    members: numMembers,
    rounds: allRounds,
    final_passed: finalPassed
  };
}
