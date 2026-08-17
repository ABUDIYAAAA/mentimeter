import crypto from "crypto";
import { io } from "socket.io-client";

const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Sam", "Riley", "Casey", "Avery",
  "Logan", "Parker", "Quinn", "Cameron", "Dakota", "Reese", "Rowan", "Hayden",
  "Skyler", "Jesse", "Finley", "Emerson", "Adrian", "Kai", "Charlie", "Peyton",
  "Kendall", "River", "Dallas", "Harper", "Rory", "Sawyer", "Elliot", "Micah",
  "Noah", "Liam", "Emma", "Olivia", "Ava", "Sophia", "Jackson", "Lucas",
  "Mia", "Ethan", "Aria", "Leo", "Maya", "Zoe", "Oliver", "Elijah", "Luna"
];

const WORD_CLOUD_VOCABULARY = [
  "Innovation", "Speed", "Scalability", "Clean", "Intuitive", "Modern",
  "Awesome", "Productive", "Collaborative", "Fast", "Interactive", "Futuristic",
  "Impact", "Delightful", "Smooth", "Creative", "Dynamic", "Powerful",
  "Minimal", "Engaging", "Realtime", "Efficient", "Polished", "Simple",
  "NextGen", "Reliable", "Elegant", "Agile", "Visionary", "Smart"
];

function getRandomNickname(index) {
  const name = FIRST_NAMES[index % FIRST_NAMES.length];
  const num = Math.floor(100 + Math.random() * 900);
  return `${name}_${num}`;
}

function randomGaussian(min, max, meanRatio = 0.72, spread = 0.18) {
  const range = max - min;
  const targetMean = min + range * meanRatio;
  const stdDev = range * spread;
  const u1 = Math.max(1e-6, Math.random());
  const u2 = Math.random();
  const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const randVal = Math.round(targetMean + stdDev * randStdNormal);
  return Math.max(min, Math.min(max, randVal));
}

function pickWeighted(options) {
  if (!options || options.length === 0) return null;
  const weights = options.map((_, i) => Math.exp(-0.45 * i) + 0.15);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < options.length; i++) {
    random -= weights[i];
    if (random <= 0) return options[i];
  }
  return options[0];
}

// Generate valid answer payload per slide
function generateSlideAnswer(slide) {
  if (slide.type === "BAR_GRAPH") {
    const options = slide.options || [];
    if (options.length === 0) return null;
    const chosen = pickWeighted(options);
    return [chosen.id];
  }

  if (slide.type === "WORD_CLOUD") {
    const numWords = Math.random() < 0.65 ? 1 : 2;
    const chosenWords = [];
    for (let w = 0; w < numWords; w++) {
      chosenWords.push(pickWeighted(WORD_CLOUD_VOCABULARY));
    }
    return chosenWords;
  }

  if (slide.type === "SCALES") {
    const min = slide.responseSettings?.minRating !== undefined ? slide.responseSettings.minRating : 1;
    const max = slide.responseSettings?.maxRating !== undefined ? slide.responseSettings.maxRating : 5;
    return randomGaussian(min, max, 0.75, 0.18);
  }

  return null;
}

// -------------------------------------------------------------
// REMOTE DEPLOYED SIMULATION (via HTTP REST + WebSockets)
// -------------------------------------------------------------
async function runRemoteSimulation(apiUrl, joinCode, count) {
  console.log(`\n🌐 Running Remote Deployed Simulation against: ${apiUrl}`);
  console.log(`🔑 Room Code: [${joinCode}] | Target Participants: ${count}\n`);

  const startTime = Date.now();

  // 1. Initial participant join to fetch presentation details
  console.log(`🔍 Probing presentation details via room code...`);
  const initialJoinRes = await fetch(`${apiUrl}/api/sessions/${joinCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: "Probe_Agent" }),
  });

  if (!initialJoinRes.ok) {
    const errText = await initialJoinRes.text();
    console.error(`\n❌ Error joining room "${joinCode}" on ${apiUrl}:`, errText);
    process.exit(1);
  }

  const initialData = await initialJoinRes.json();
  const presentationId = initialData.session.presentationId;
  const sessionId = initialData.session.id;

  // 2. Fetch presentation question slides
  const presRes = await fetch(`${apiUrl}/api/presentations/${presentationId}`);
  if (!presRes.ok) {
    console.error(`\n❌ Error fetching presentation ${presentationId}`);
    process.exit(1);
  }

  const presentation = await presRes.json();
  const answerableSlides = (presentation.slides || []).filter((s) => s.type !== "CONTENT");

  console.log(`📋 Presentation: "${presentation.title || "Untitled"}"`);
  console.log(`📊 Found ${answerableSlides.length} answerable questions:`);
  answerableSlides.forEach((s, idx) => {
    console.log(`   ${idx + 1}. [${s.type}] ${s.question || "Untitled"}`);
  });

  // 3. Concurrently register and vote in parallel batches
  console.log(`\n⚡ Simulating ${count} audience members in high-throughput concurrent batches...`);

  const BATCH_SIZE = 50; // 50 concurrent participants per batch
  let completedParticipants = 0;
  let totalVotesSubmitted = 0;

  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const currentBatchSize = Math.min(BATCH_SIZE, count - batchStart);
    const promises = [];

    for (let i = 0; i < currentBatchSize; i++) {
      const pIndex = batchStart + i;
      promises.push(
        (async () => {
          try {
            // A. Join session
            const nickname = getRandomNickname(pIndex);
            const joinRes = await fetch(`${apiUrl}/api/sessions/${joinCode}/join`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nickname }),
            });

            if (!joinRes.ok) return;
            const joinPayload = await joinRes.json();
            const token = joinPayload.participantToken;
            if (!token) return;

            // B. Connect socket
            const socket = io(apiUrl, {
              query: { token },
              transports: ["websocket"],
              reconnection: false,
              timeout: 10000,
            });

            await new Promise((resolve) => {
              socket.on("connect", () => {
                // C. Submit answers for all slides
                for (const slide of answerableSlides) {
                  const answer = generateSlideAnswer(slide);
                  if (answer !== null) {
                    socket.emit("submit_response", {
                      slideId: slide._id || slide.id,
                      answer,
                      commandId: crypto.randomUUID(),
                    });
                    totalVotesSubmitted++;
                  }
                }

                // Brief pause then disconnect cleanly
                setTimeout(() => {
                  socket.disconnect();
                  resolve(true);
                }, 300);
              });

              socket.on("connect_error", () => {
                socket.disconnect();
                resolve(false);
              });
            });

            completedParticipants++;
          } catch (_) {}
        })()
      );
    }

    await Promise.all(promises);

    const progressPct = Math.round((completedParticipants / count) * 100);
    process.stdout.write(`\r🚀 Ingested: ${completedParticipants}/${count} participants (${progressPct}%) — ${totalVotesSubmitted} total responses...`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n\n=======================================================");
  console.log(`🎉 REMOTE SIMULATION COMPLETE IN ${duration}s!`);
  console.log(`🌐 Target Server: ${apiUrl}`);
  console.log(`🔑 Room Code: ${joinCode}`);
  console.log(`👥 Participants Joined: ${completedParticipants}`);
  console.log(`📝 Total Responses Submitted: ${totalVotesSubmitted}`);
  console.log("=======================================================\n");
  process.exit(0);
}

// -------------------------------------------------------------
// LOCAL DIRECT DB SIMULATION (Ultra-Fast Engine)
// -------------------------------------------------------------
async function runLocalDbSimulation(joinCode, count) {
  const { connectMongo } = await import("./src/core/database/connect.js");
  const { default: env } = await import("./src/core/env/env.js");
  const { Session, Slide, Response, Participant } = await import("./src/core/database/models/index.js");
  const { syncer } = await import("./realtime/syncer.js");

  console.log(`\n💾 Running Direct Local Database Engine...`);
  console.log(`🔑 Room Code: [${joinCode}] | Target: ${count} participants\n`);

  const [connection, error] = await connectMongo(env.MONGO_URI);
  if (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }

  const startTime = Date.now();

  const session = await Session.findOne({ code: joinCode }).lean();
  if (!session) {
    console.error(`\n❌ Error: No session found with join code "${joinCode}".`);
    process.exit(1);
  }

  const sessionId = session._id;
  const presentationId = session.presentationId;

  const slides = await Slide.find({ presentationId }).sort({ position: 1 }).lean();
  const answerableSlides = slides.filter((s) => s.type !== "CONTENT");

  console.log(`📋 Found ${answerableSlides.length} question slides.`);

  // Create participants
  console.log(`👥 Generating ${count} participant profiles in bulk...`);
  const participantDocs = [];
  const participantIds = [];

  for (let i = 0; i < count; i++) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const participantId = new connection.base.Types.ObjectId();

    participantDocs.push({
      _id: participantId,
      sessionId,
      nickname: getRandomNickname(i),
      tokenHash,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    participantIds.push(participantId);
  }

  await Participant.insertMany(participantDocs, { ordered: false });

  let totalVotes = 0;

  for (let sIdx = 0; sIdx < answerableSlides.length; sIdx++) {
    const slide = answerableSlides[sIdx];
    const slideId = slide._id;
    const slideResponses = [];

    if (slide.type === "BAR_GRAPH") {
      const options = slide.options || [];
      if (options.length === 0) continue;
      const voteCounts = {};
      for (const opt of options) voteCounts[opt.id] = 0;

      for (let i = 0; i < count; i++) {
        const chosenOpt = pickWeighted(options);
        voteCounts[chosenOpt.id] = (voteCounts[chosenOpt.id] || 0) + 1;
        slideResponses.push({
          sessionId,
          presentationId,
          slideId,
          participantId: participantIds[i],
          type: "select",
          answer: { optionIds: [chosenOpt.id] },
          commandId: crypto.randomUUID(),
          submittedAt: new Date(),
        });
      }

      await Response.insertMany(slideResponses, { ordered: false });
      totalVotes += slideResponses.length;

      await Slide.updateOne(
        { _id: slideId },
        {
          $set: {
            options: options.map((opt) => ({
              ...opt,
              voteCount: (opt.voteCount || 0) + (voteCounts[opt.id] || 0),
            })),
          },
        }
      );
    } else if (slide.type === "WORD_CLOUD") {
      const isUnlimited = Boolean(
        slide.responseSettings?.multipleSubmissions === true ||
        slide.responseSettings?.maxEntriesPerParticipant === 0
      );
      const entriesPerParticipant = isUnlimited ? Math.floor(1 + Math.random() * 3) : 1;
      const wordCounts = {};

      for (let i = 0; i < count; i++) {
        for (let e = 0; e < entriesPerParticipant; e++) {
          const word = pickWeighted(WORD_CLOUD_VOCABULARY);
          wordCounts[word] = (wordCounts[word] || 0) + 1;

          slideResponses.push({
            sessionId,
            presentationId,
            slideId,
            participantId: participantIds[i],
            type: "text",
            answer: { text: word, raw: [word] },
            commandId: crypto.randomUUID(),
            submittedAt: new Date(),
          });
        }
      }

      await Response.insertMany(slideResponses, { ordered: false });
      totalVotes += slideResponses.length;

      const wordCloudOptions = Object.entries(wordCounts).map(([text, value], index) => ({
        id: `word-${index}-${text}`,
        label: text,
        voteCount: value,
      }));

      await Slide.updateOne({ _id: slideId }, { $set: { options: wordCloudOptions } });
    } else if (slide.type === "SCALES") {
      const min = slide.responseSettings?.minRating !== undefined ? slide.responseSettings.minRating : 1;
      const max = slide.responseSettings?.maxRating !== undefined ? slide.responseSettings.maxRating : 5;
      const dist = {};
      for (let r = min; r <= max; r++) dist[r] = 0;

      for (let i = 0; i < count; i++) {
        const ratingVal = randomGaussian(min, max, 0.75, 0.18);
        dist[ratingVal] = (dist[ratingVal] || 0) + 1;

        slideResponses.push({
          sessionId,
          presentationId,
          slideId,
          participantId: participantIds[i],
          type: "rating",
          answer: { rating: ratingVal, raw: ratingVal },
          commandId: crypto.randomUUID(),
          submittedAt: new Date(),
        });
      }

      await Response.insertMany(slideResponses, { ordered: false });
      totalVotes += slideResponses.length;

      const scaleOptions = Object.entries(dist).map(([r, v]) => ({
        id: `rate-${r}`,
        label: String(r),
        voteCount: v,
      }));

      await Slide.updateOne({ _id: slideId }, { $set: { options: scaleOptions } });
    }

    try {
      await syncer.broadcastSlideAnalytics(sessionId, slideId, slide.type);
    } catch (_) {}
  }

  try {
    await syncer.broadcastState(sessionId);
  } catch (_) {}

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=======================================================");
  console.log(`🎉 LOCAL DB SIMULATION COMPLETE IN ${duration}s!`);
  console.log(`👥 Participants: ${count}`);
  console.log(`📝 Total Responses: ${totalVotes}`);
  console.log("=======================================================\n");
  process.exit(0);
}

// -------------------------------------------------------------
// CLI DISPATCHER
// -------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const rawCode = args[0];
  const count = parseInt(args[1] || "1500", 10);
  const targetUrl = args[2] || process.env.TARGET_URL || process.env.API_URL;

  if (!rawCode) {
    console.error("\n❌ Usage: node simulate-audience.js <ROOM_CODE> [COUNT=1500] [URL]");
    console.error("\nExamples:");
    console.error("  # Against deployed backend (via HTTP/WebSocket):");
    console.error("  node simulate-audience.js 'KVY NPI' 1500 https://your-menti-backend.domain.com");
    console.error("\n  # Against local environment (direct MongoDB):");
    console.error("  node simulate-audience.js 'KVY NPI' 1500\n");
    process.exit(1);
  }

  const joinCode = rawCode.replace(/\s+/g, "").toUpperCase();

  if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
    await runRemoteSimulation(targetUrl.replace(/\/$/, ""), joinCode, count);
  } else {
    // If no remote URL specified, check if TARGET_URL or NEXT_PUBLIC_MENTI_API_URL exists or run local DB
    const envUrl = process.env.TARGET_URL || process.env.NEXT_PUBLIC_MENTI_API_URL;
    if (envUrl && (envUrl.startsWith("http://") || envUrl.startsWith("https://")) && !envUrl.includes("localhost")) {
      await runRemoteSimulation(envUrl.replace(/\/$/, ""), joinCode, count);
    } else {
      await runLocalDbSimulation(joinCode, count);
    }
  }
}

main();
