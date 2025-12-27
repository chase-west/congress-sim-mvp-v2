
import { decideVote, type Member } from "../lib/simulation/agents.js"; // Note .js extension for ESM if needed, or tsx handles ts
import type { Bill } from "../lib/api.js";

// Mock Data
const mockMember: Member = {
  member_id: "M001",
  district: {
    district_id: "D01",
    name: "Test Dist",
    lean: 0.5,
    population: 1000,
    weights: { economy: 0.8, climate: 0.2 } as any
  },
  ideology: 0.4,
  party_hint: "Blue"
};

const mockBill: Bill = {
  title: "Save the Whales Act",
  summary: "This bill bans all whale hunting and provides funding for marine sanctuaries.",
  issue_vector: {} as any
};

console.log("Testing decideVote with Mock Data...");

// We will test with useLlm = false first (fallback)
// Then try to ping local LLM?
// We can't easily mock fetch here without a polyfill in this script, or we rely on node's fetch (Node 18+ has it).
// We'll perform a real call if we can, or just test the fallback.

async function test() {
  try {
    console.log("1. Testing Fallback (No LLM)...");
    const res1 = await decideVote(mockMember, mockBill, false, "dummy");
    console.log("Fallback Result:", res1);

    console.log("2. Testing Local LLM (if available)...");
    // This might fail if no local LLM, so we wrap in try/catch and log warning
    try {
      // Check if we can reach localhost:11434 first?
      const res2 = await decideVote(mockMember, mockBill, true, "llama3.2");
      console.log("LLM Result:", res2);
    } catch (e) {
      console.log("LLM Test Skipped/Failed (Expected if no local LLM):", e.message);
    }

  } catch (e) {
    console.error("Test Failed:", e);
  }
}

test();
