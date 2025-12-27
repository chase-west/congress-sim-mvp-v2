import type { Bill, District, Vote } from "../api";

export interface Member {
  member_id: string;
  district: District;
  ideology: number; // -1..+1
  party_hint: string;
}

export interface VoteDecision {
  vote: "yes" | "no" | "abstain";
  rationale: string;
}

export async function decideVote(member: Member, bill: Bill, useLlm: boolean, llmModel: string): Promise<VoteDecision> {
  if (!useLlm) {
    // Fallback simple logic if LLM disabled (e.g. for testing without heavy compute)
    // We can't use the old vector logic accurately since we killed it, so we'll just random or base on ideology noise
    const roll = Math.random();
    // Rough heuristic: ideology vs nothing (since bill has no vector now)
    // This is just a placeholder fallback.
    return {
      vote: roll > 0.5 ? "yes" : "no",
      rationale: "LLM disabled; random heuristic vote."
    };
  }

  // Build Prompt
  const prompt = `
You are a Representative in the US Congress.
Your Profile:
- District: ${member.district.name} (Lean: ${member.district.lean > 0 ? "Democrat" : "Republican"} ${member.district.lean.toFixed(2)})
- Ideology: ${member.ideology.toFixed(2)} (-1.0=Far Right, +1.0=Far Left)
- Key District Interests: ${Object.entries(member.district.weights).map(([k, v]) => `${k}:${v}`).join(", ")}

The Bill:
Title: ${bill.title}
Summary: ${bill.summary}

Task:
Decide how to vote on this bill. 
Consider your district's interests and your ideology.
Return a JSON object with:
{
  "vote": "yes" or "no" or "abstain",
  "rationale": "One sentence explaining why."
}
Do not output markdown, just the JSON.
`;

  try {
    // We assume the same local proxy or endpoint as debate.ts for now.
    // Ideally this should be a shared API utility.
    // Checking if we have a global fetcher or need to do it here. 
    // Adapting from debate.ts pattern:

    let responseText = "";

    if (llmModel.includes("local") || llmModel.startsWith("llama")) {
      const r = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        body: JSON.stringify({
          model: llmModel,
          prompt: prompt + "\n\nResponse:",
          stream: false,
          format: "json" // Force JSON mode if supported
        }),
      });
      const data = await r.json();
      responseText = data.response;
    } else {
      // TODO: Add support for external APIs (Gemini/OpenAI) if valid key present
      // For now, fail over to local or throw
      console.warn("External model not fully wired in agents.ts yet, trying local fallback logic.");
      throw new Error("Model not supported");
    }

    // Parse JSON
    try {
      const clean = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      const json = JSON.parse(clean);
      return {
        vote: json.vote.toLowerCase(),
        rationale: json.rationale
      };
    } catch (e) {
      console.error("Failed to parse LLM vote:", responseText);
      return { vote: "abstain", rationale: "Failed to parse reasoning." };
    }

  } catch (err) {
    console.error("LLM Vote Error:", err);
    // Fallback
    return { vote: "abstain", rationale: "Error in decision process." };
  }
}
