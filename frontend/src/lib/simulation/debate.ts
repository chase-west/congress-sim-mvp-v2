import type { Bill } from "../api";
import type { Member } from "./agents";

export type Stance = "support" | "oppose" | "amend";

export function templateSpeech(member: Member, stance: Stance, bill: Bill): string {
  // Fallback if no LLM.
  // Since we removed issue vectors, we can't do the "climate expands" logic anymore easily without analyzing text.
  // We'll return a generic placeholder that encourages using the LLM mode.

  const leanWord = member.district.lean > 0.15 ? "left-leaning"
    : member.district.lean < -0.15 ? "right-leaning"
      : "mixed";

  if (stance === "support") {
    return `I support the ${bill.title}. My district is ${leanWord}, and I believe this legislation moves us in the right direction.`;
  }
  if (stance === "oppose") {
    return `I oppose the ${bill.title}. My district is ${leanWord}, and this bill does not align with our values or priorities.`;
  }
  return `I have concerns about the ${bill.title}. My district is ${leanWord}; we need to address specific flaws before I can support this.`;
}

// TODO: Integrate WebLLM or local Ollama here
export async function generateSpeech(
  member: Member,
  stance: Stance,
  bill: Bill,
  useLlm: boolean,
  llmModel: string
): Promise<string> {
  if (!useLlm) {
    return templateSpeech(member, stance, bill);
  }

  // For now, fall back to template until WebLLM hook is added
  // Or fetch from local Ollama if we want to keep that feature without a Python backend proxy
  if (llmModel.includes("local") || llmModel.startsWith("llama")) {
    try {
      const prompt = buildPrompt(member, stance, bill);
      const r = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        body: JSON.stringify({ model: llmModel, prompt, stream: false }),
      });
      if (r.ok) {
        const data = await r.json();
        return data.response.trim();
      }
    } catch (e) {
      console.warn("Local Ollama fetch failed, using template", e);
    }
  }

  return templateSpeech(member, stance, bill);
}

function buildPrompt(member: Member, stance: Stance, bill: Bill): string {
  const weights = Object.entries(member.district.weights).map(([k, v]) => `${k}:${v}`).join(", ");

  return `You are a generic elected representative in a simulated legislature. 
Do NOT reference real people, parties, or scandals. 
Write a concise argument (<=60 words).

District lean: ${member.district.lean > 0 ? "Democrat" : "Republican"} (${member.district.lean.toFixed(2)})
District priorities: ${weights}
Member Ideology: ${member.ideology.toFixed(2)}
Bill: ${bill.title}
Summary: ${bill.summary}
Stance: ${stance}
Argument:`;
}
