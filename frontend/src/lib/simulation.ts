import { type Issue, type Bill, type DistrictSummary, type District } from "./api";
import * as webllm from "@mlc-ai/web-llm";

export type Stance = "support" | "oppose" | "amend";

export type Member = {
  member_id: string;
  district: District;
  ideology: number;
  party_hint: string;
};

export type Speech = {
  member_id: string;
  stance: Stance;
  text: string;
  rationale: Record<string, number>; // Deprecated but kept for type compat (send empty)
};

export type Vote = {
  yes: number;
  no: number;
  abstain: number;
  passed: boolean;
  threshold: number;
  rollCall: Record<string, "yes" | "no" | "abstain">;
};

export type Round = {
  round_index: number;
  speeches: Speech[];
  vote: Vote;
  amendment?: string;
};

export type SimResult = {
  members: Member[];
  rounds: Round[];
  final_passed: boolean;
  notes: string[];
  final_statements?: Record<string, string>;
};

// --- Helper: Sampling ---

function sampleMembers(districts: District[], n: number, rngSeed: number | null): Member[] {
  const members: Member[] = [];
  // Simple round robin if density is high, or random sample
  // We'll just loop through districts provided
  for (let i = 0; i < n; i++) {
    const d = districts[i % districts.length];
    // Add noise to ideology
    const noise = (Math.random() - 0.5) * 0.4;
    let ideology = d.lean + noise;
    ideology = Math.max(-1, Math.min(1, ideology));
    const party_hint = ideology > 0.1 ? "Blue" : ideology < -0.1 ? "Red" : "Purple";

    members.push({
      member_id: `M-${String(i + 1).padStart(4, "0")}`,
      district: d,
      ideology,
      party_hint
    });
  }
  return members;
}

// --- LLM Logic ---

export const AVAILABLE_MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B (Fast, Efficient)" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 1.5B (Logic Optimized)" },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 8B (High Quality, Slow)" },
];

export interface SimOptions {
  bill: Bill;
  districtSummary: DistrictSummary;
  numMembers: number;
  rounds: number;
  useLlm: boolean;
  llmConfig?: {
    model: string;
    onProgress: (text: string, percent?: number) => void;
  };
  seed?: number | null;
  onInit?: (members: Member[]) => void;
  onSpeech?: (roundIndex: number, speech: Speech) => void;
  onRoundComplete?: (round: Round) => void;
  onPhase?: (phase: string) => void;
  onVoteUpdate?: (vote: Vote) => void;
  parallelLimit?: number;
}

let loadedEngine: webllm.MLCEngineInterface | null = null;
let currentModelId: string | null = null;

// Batch voting prompt
function buildBatchVotePrompt(bill: Bill, members: Member[]): string {
  const profiles = members.map(m => {
    // Shorter profile to fit context
    const weights = Object.entries(m.district.weights)
      .sort(([, a], [, b]) => b - a).slice(0, 3).map(([k]) => k).join(",");
    return `${m.member_id} (${m.district.lean > 0 ? "D" : "R"}, ${m.district.lean.toFixed(2)}): ${weights}`;
  }).join("\n");

  // Extract explicit amendment if present for emphasis
  const amendMatch = bill.summary.match(/AMENDMENT \(Round \d+\): (.*)/);
  const amendmentText = amendMatch ? amendMatch[1] : null;

  return `
[SYSTEM]
You are a simulator.
Bill: ${bill.title}
Context: ${bill.text_content ? bill.text_content.slice(0, 800) : bill.summary}

${amendmentText ? `
*** UPDATE: A COMPROMISE AMENDMENT IS PROPOSED ***
Amendment: "${amendmentText}"
Instruction: Vote based on whether this amendment satisfies your party's concerns.
` : ""}

Task: Decide how these representatives vote (YES/NO).
Rules:
1. Democrats (D) generally support liberal/climate/healthcare bills.
2. Republicans (R) generally support conservative/economy/border bills.
3. If an amendment makes it better for your side, vote YES.
4. Use their priorities/weights to decide.

Output strictly:
M-xxx: YES
M-xxx: NO

Representatives:
${profiles}

Output:
`.trim();
}

async function batchVote(engine: webllm.MLCEngineInterface, bill: Bill, members: Member[], onProgress?: (msg: string) => void, onVoteUpdate?: (vote: Vote) => void, parallelLimit: number = 5): Promise<Record<string, "yes" | "no" | "abstain">> {
  const results: Record<string, "yes" | "no" | "abstain"> = {};

  // Decide how many to run in parallel? 
  // For stability with local LLM, we should stick to serial or very low concurrency.
  // Sequential is safest to avoid memory issues or state conflict in the engine.

  const contextText = bill.text_content ? bill.text_content.slice(0, 2000) : bill.summary;

  let yes = 0;
  let no = 0;
  let abstain = 0;

  // Parallel config
  const PARALLEL_LIMIT = parallelLimit;

  for (let i = 0; i < members.length; i += PARALLEL_LIMIT) {


    const chunk = members.slice(i, i + PARALLEL_LIMIT);
    const promises = chunk.map(async (m, idx) => {
      // Add small jitter to prevent race conditions in local engine state
      await new Promise(r => setTimeout(r, idx * 50));

      // Determine Bill Lean roughly (is it a Dem bill or GOP bill?)
      // We can guess this by the text content or just random chance if unknown.
      // But let's let the agent decide based on the content.

      const thoughtPrompt = `
[SYSTEM]
Roleplay as Rep ${m.member_id} (${m.district.lean > 0 ? "Dem" : "GOP"}).
District Priorities: ${Object.keys(m.district.weights).join(", ")}.
Bill: "${bill.title}"
Context: ${contextText.slice(0, 1500)}

Task: Vote YES or NO.
Rules:
1. Does this bill align with your party? (Dem: Social programs, Climate. GOP: Tax cuts, Border, Defense).
2. Does it help your district priorities?
3. Vote YES if it matches EITHER party OR district.
4. Vote NO if it matches NEITHER.

Output: Just one word: YES or NO.


`.trim();

      try {
        // Note: engine.chat.completions.create MIGHT auto-queue if single threaded, 
        // but WebLLM generally handles async calls well.
        const reply = await engine.chat.completions.create({
          messages: [{ role: "user", content: thoughtPrompt }],
          max_tokens: 10,
          temperature: 0.5,
        });

        const txt = reply.choices[0].message.content?.toLowerCase() || "";
        let vote: "yes" | "no" | "abstain" = "abstain";

        if (txt.includes("yes") || txt.includes("aye") || txt.includes("support")) vote = "yes";
        else if (txt.includes("no") || txt.includes("nay") || txt.includes("oppose")) vote = "no";
        else vote = "abstain"; // Fallback for confused/error/empty

        // Debug Log
        // console.log(`[Vote] ${m.member_id} (${m.district.lean}): ${vote} based on ${txt}`);

        return { id: m.member_id, vote };
      } catch (e) {
        console.error("Vote failed", e);
        return { id: m.member_id, vote: "abstain" as const };
      }
    });

    const chunkResults = await Promise.all(promises);

    // Update tallies
    for (const res of chunkResults) {
      results[res.id] = res.vote;
      if (res.vote === "yes") yes++;
      else if (res.vote === "no") no++;
      else abstain++;
    }

    // Stability Check
    const totalSoFar = yes + no + abstain;
    if (onProgress) {
      let msg = `VOTING PROGRESS: ${Math.min(i + PARALLEL_LIMIT, members.length)}/${members.length} MEMBERS DECIDED...`;
      if (totalSoFar > 10 && (abstain / totalSoFar) > 0.2) {
        msg += ` (WARNING: High Failure Rate. Reduce Parallel Limit!)`;
      }
      onProgress(msg);
    }

    // Update UI
    if (onVoteUpdate) {
      onVoteUpdate({
        yes,
        no,
        abstain,
        passed: yes > (yes + no) * 0.5,
        threshold: 0.5,
        rollCall: { ...results }
      });
    }
  }

  // Final update
  if (onVoteUpdate) {
    onVoteUpdate({
      yes,
      no,
      abstain,
      passed: yes > (yes + no) * 0.5,
      threshold: 0.5,
      rollCall: { ...results }
    });
  }

  return results;
}

// Single speech prompt
function buildSpeechPrompt(member: Member, bill: Bill, stance: Stance, roundIndex: number = 0): string {
  const topPriorities = Object.entries(member.district.weights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([k]) => k.toUpperCase());

  const districtName = member.district.name || "District " + member.member_id;

  // PERSONA INJECTION
  const personas = [
    "A pragmatic local representative focused on jobs.",
    "A passionate defender of traditional values.",
    "A forward-looking advocate for technology and progress.",
    "A skeptical fiscal conservative worried about the budget.",
    "A community organizer focused on families."
  ];
  // Hash member ID + round to vary persona tone/consistency
  const seed = member.member_id.split("").reduce((a, b) => a + b.charCodeAt(0), 0) + roundIndex;
  const persona = personas[seed % personas.length];

  const startPhrase = stance === "support"
    ? "I rise today in strong support,"
    : stance === "oppose"
      ? "I rise to vehemently oppose this bill,"
      : "we cannot move forward without addressing";

  return `
[SYSTEM]
You are a pragmatic Member of Congress.
Task: Give a ONE SENTENCE reason for voting ${stance.toUpperCase()} on the bill "${bill.title}".

[RULES]
1. Use PLAIN ENGLISH. No fancy jargon.
2. USE COMMON SENSE. 
3. Don't mention "Fiscal Hollows" or weird phrases.
4. Do NOT repeat the bill title.
5. Do NOT mention your ID.

[OUTPUT]
Write only the argument. Start directly.
`.trim();
}

// Amendment prompt
async function generateAmendment(engine: webllm.MLCEngineInterface, bill: Bill, speeches: Speech[], voteFailed: boolean = false): Promise<string> {
  // Use ALL speeches to find conflict boundaries
  let complaints = speeches
    .map(s => `[${s.stance.toUpperCase()}] ${s.text}`)
    .join("\n");

  let prompt = "";

  if (voteFailed) {
    prompt = `
[SYSTEM]
You are a legislative aide. The bill "${bill.title}" FAILED the vote.
Transcript:
${complaints.slice(0, 2000)}

Task: Identify the fatal flaw and draft a COMPROMISE AMENDMENT to fix it.
Rules:
1. Propose a CONCRETE change (e.g. "Reduce funding by 20%", "Add oversight", "Cut taxes").
2. It MUST address implied or stated concerns.
3. Keep it to 1 sentence.

Amendment:
`.trim();
  } else {
    prompt = `
[SYSTEM]
You are a legislative aide.
Bill: "${bill.title}"
Transcript:
${complaints.slice(0, 2000)}

Task: Draft an AMENDMENT to address any concerns.
Rules:
1. Propose a CONCRETE change.
2. Keep it to 1 sentence.

Amendment:
`.trim();
  }

  const reply = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }]
  });
  return reply.choices[0].message.content || "Add a budgetary oversight committee to monitor spending.";
}


// --- Main Client Runner ---

export async function runSimulationClient(opts: SimOptions): Promise<SimResult> {
  const { bill, districtSummary, numMembers, rounds, useLlm, llmConfig, seed, onSpeech, onRoundComplete } = opts;

  // 1. Init Engine
  if (useLlm && llmConfig && (!loadedEngine || currentModelId !== llmConfig.model)) {
    llmConfig.onProgress("Loading AI Model...", 0);
    const engine = new webllm.MLCEngine();
    engine.setInitProgressCallback((rep) => {
      const match = rep.text.match(/(\d+)%/);
      llmConfig.onProgress(rep.text, match ? parseInt(match[1]) : undefined);
    });
    await engine.reload(llmConfig.model);
    loadedEngine = engine;
    currentModelId = llmConfig.model;
  }

  // 2. Members
  if (!districtSummary.sample?.length) throw new Error("No districts");
  // Expand districts if needed
  const filledDistricts: District[] = [];
  for (let i = 0; i < numMembers; i++) {
    filledDistricts.push(districtSummary.sample[i % districtSummary.sample.length]);
  }
  const members = sampleMembers(filledDistricts, numMembers, seed || null);
  if (opts.onInit) opts.onInit(members);

  const allRounds: Round[] = [];
  const notes: string[] = [];
  let currentBill = { ...bill };

  for (let r = 0; r < rounds; r++) {
    const speeches: Speech[] = [];

    // Pick 5 speakers randomly (or weighted by extreme lean? Nah random is fair for now)
    // Actually, let's pick "Leadership" (Extreme ends) and "Moderates"
    const sorted = [...members].sort((a, b) => a.ideology - b.ideology);
    const speakers = [
      sorted[0], // Far Right
      sorted[Math.floor(sorted.length * 0.25)],
      sorted[Math.floor(sorted.length * 0.5)], // Median
      sorted[Math.floor(sorted.length * 0.75)],
      sorted[sorted.length - 1] // Far Left
    ];

    // Generate Speeches
    for (const s of speakers) {
      const spObj = { member_id: s.member_id, stance: "amend" as Stance, text: "", rationale: {} };

      if (useLlm && loadedEngine) {
        // Step 1: Decision
        // We use the text_content if available for a more accurate read, or fallback to summary
        const contextText = currentBill.text_content ? currentBill.text_content.slice(0, 1000) : currentBill.summary;

        const thoughtPrompt = `
[SYSTEM]
Roleplay as Rep ${s.member_id} (${s.district.lean > 0 ? "Dem" : "GOP"}).
District Priorities: ${Object.keys(s.district.weights).join(", ")}.
Bill: "${currentBill.title}"
Context: ${contextText.slice(0, 500)}

Task: Vote YES or NO.
Rules:
1. Does this bill align with your party? (Dem: Social programs, Climate. GOP: Tax cuts, Border, Defense).
2. Does it help your district priorities?
3. Vote YES if it matches EITHER party OR district.
4. Rule: Vote YES if it helps EITHER Party OR District. Vote NO if it helps NEITHER.
5. REALISM CHECK: Only count "District Priority" if the bill explicitly helps that sector. Do not force connections between unrelated topics.
6. BE DECISIVE.

Output: Just one word: YES or NO.
`.trim();

        const thought = await loadedEngine.chat.completions.create({ messages: [{ role: "user", content: thoughtPrompt }] });
        const t = thought.choices[0].message.content?.toLowerCase() || "";

        if (t.includes("yes")) spObj.stance = "support";
        else if (t.includes("no")) spObj.stance = "oppose";
        else spObj.stance = "amend"; // fallback

        // Step 2: Speech
        // Add round index to seed to vary tone across rounds
        const speechPrompt = buildSpeechPrompt(s, currentBill, spObj.stance, r);
        const sp = await loadedEngine.chat.completions.create({ messages: [{ role: "user", content: speechPrompt }] });

        // POST-PROCESS CLEANUP
        let raw = sp.choices[0].message.content || "";

        // Basic cleanup
        raw = raw.replace(/Here is the dialogue:|I cannot fulfill|M-\d+/gi, "");
        raw = raw.replace(/"/g, "").trim();

        // Fix duplications like "I rise... I rise..."
        // We just take the first sincere sentence.
        if (raw.indexOf(".") > -1) {
          raw = raw.split(".")[0] + ".";
        }

        // Add prefix if missing
        if (!raw.toLowerCase().startsWith("mr. speaker")) {
          const prefix = spObj.stance === "support" ? "Mr. Speaker, I support this because" : "Mr. Speaker, I oppose this because";
          raw = `${prefix} ${raw.charAt(0).toLowerCase() + raw.slice(1)}`;
        }

        spObj.text = raw.slice(0, 300);

      } else {
        // Fallback: Ideology driven (Lean > 0 is Dem usually YES for Dem bills, but it varies)
        // NOTE: This fallback needs to be smarter or randomized if we want "debate"
        // Let's make it probability based per member ideology
        const prob = (s.ideology + 1) / 2; // -1 -> 0, +1 -> 1
        spObj.stance = Math.random() < prob ? "support" : "oppose";
        spObj.text = "I have no brain (LLM disabled).";
      }

      speeches.push(spObj);
      if (onSpeech) onSpeech(r, spObj);
    }

    // VOTE
    let voteRes: Vote;
    if (useLlm && loadedEngine) {
      if (opts.onPhase) opts.onPhase(`Starting vote for ${members.length} members...`);
      const votes = await batchVote(
        loadedEngine,
        currentBill,
        members,
        (msg) => { if (opts.onPhase) opts.onPhase(msg); },
        opts.onVoteUpdate, // Pass the callback
        opts.parallelLimit || 5
      );
      let yes = 0, no = 0, abs = 0;

      // 1. Process batch votes
      for (const [mid, v] of Object.entries(votes)) {
        // This will be overwritten below for speakers
        if (v === "yes") yes++;
        else if (v === "no") no++;
        else abs++;
      }

      // 2. FORCE CONSISTENCY: Override votes for members who gave speeches
      for (const s of speeches) {
        const currentVote = votes[s.member_id];
        let forcedVote: "yes" | "no" | "abstain" = "abstain";

        if (s.stance === "support") forcedVote = "yes";
        else if (s.stance === "oppose") forcedVote = "no";
        else forcedVote = "abstain";

        if (currentVote !== forcedVote) {
          // adjust counts
          if (currentVote === "yes") yes--;
          else if (currentVote === "no") no--;
          else abs--;

          if (forcedVote === "yes") yes++;
          else if (forcedVote === "no") no++;
          else abs++;

          votes[s.member_id] = forcedVote;
        }
      }

      // 3. FINAL UI UPDATE after consistency check
      if (opts.onVoteUpdate) {
        voteRes = { yes, no, abstain: abs, passed: yes > (yes + no) * 0.5, threshold: 0.5, rollCall: votes };
        opts.onVoteUpdate(voteRes);
      } else {
        voteRes = { yes, no, abstain: abs, passed: yes > (yes + no) * 0.5, threshold: 0.5, rollCall: votes };
      }


      voteRes = { yes, no, abstain: abs, passed: yes > (yes + no) * 0.5, threshold: 0.5, rollCall: votes };
    } else {
      voteRes = { yes: Math.floor(numMembers / 2), no: Math.floor(numMembers / 2), abstain: 0, passed: false, threshold: 0.5, rollCall: {} };
    }

    const roundObj: Round = { round_index: r, speeches, vote: voteRes };
    allRounds.push(roundObj);

    if (onRoundComplete) onRoundComplete(roundObj);

    if (voteRes.passed) {
      notes.push(`Passed in round ${r + 1}.`);
      break;
    } else if (r < rounds - 1) {
      // AMEND
      if (useLlm && loadedEngine) {
        // Pass 'true' for voteFailed context
        const amendText = await generateAmendment(loadedEngine, currentBill, speeches, true);
        currentBill.summary += `\n\nAMENDMENT (Round ${r + 1}): ${amendText}`;
        roundObj.amendment = amendText;
        notes.push(`Amendment Proposed: ${amendText}`);
      }
    }
  }

  return {
    members,
    rounds: allRounds,
    final_passed: allRounds[allRounds.length - 1]?.vote.passed || false,
    notes
  };
}

// Stub for legacy compatibility
export function utilityByIssue(member: Member, issueVector: any): Record<string, number> {
  return member.district.weights;
}
