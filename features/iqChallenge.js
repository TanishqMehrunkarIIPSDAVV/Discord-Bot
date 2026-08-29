const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  userMention,
} = require("discord.js");
const client = require(`${path.dirname(__dirname)}/index.js`);
const config = require("../config.json");
const { addQuestCoins, getQuestCoins } = require("../utils/questStore");

const PREFIX = "ct";
const CHALLENGE_WORD = "challenge";
const CHALLENGE_TIMEOUT_MS = 90_000;
const ROUND_TIMEOUT_MS = 100_000;
const BETWEEN_ROUNDS_MS = 8_000;
const ROUND_WIN_COINS = 25;

const BTN_CHALLENGE_ACCEPT = "iq_challenge_accept:";
const BTN_CHALLENGE_DECLINE = "iq_challenge_decline:";
const BTN_GUESS = "iq_guess:";
const BTN_EXIT = "iq_exit:";

const pendingChallenges = new Map();
const activeGames = new Map();
const userToGame = new Map();

const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || "").trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const GENERIC_AI_API_KEY = String(process.env.AI_API_KEY || "").trim();
const AI_API_URL = String(process.env.AI_API_URL || "").trim();
const AI_PROVIDER = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
const USER_DEFINED_MODEL = String(process.env.AI_MODEL || "").trim();

const pickFirstString = (source, keys) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const getIqChallengeChannelConfigId = () => {
  return pickFirstString(config, [
    "iqChallengeChannelId",
  ]);
};

const getUserGameKey = (guildId, userId) => `${guildId}:${userId}`;

const detectProviderFromUrl = (url) => {
  if (!url) return null;
  const lower = String(url).toLowerCase();
  if (lower.includes("openrouter.ai")) return "openrouter";
  if (lower.includes("api.openai.com")) return "openai";
  return null;
};

const detectProviderFromApiKey = (apiKey) => {
  if (!apiKey) return null;
  const key = String(apiKey).trim().toLowerCase();
  if (key.startsWith("sk-or-v1")) return "openrouter";
  if (key.startsWith("sk-")) return "openai";
  return null;
};

const resolveAiRuntimeConfig = () => {
  const providerFromUrl = detectProviderFromUrl(AI_API_URL);
  const providerFromKey = [
    detectProviderFromApiKey(OPENROUTER_API_KEY),
    detectProviderFromApiKey(OPENAI_API_KEY),
    detectProviderFromApiKey(GENERIC_AI_API_KEY),
  ].find(Boolean) || null;

  const provider = AI_PROVIDER || providerFromUrl || providerFromKey;
  const preferOpenRouter = provider === "openrouter" || (!provider && OPENROUTER_API_KEY);

  if (preferOpenRouter) {
    return {
      provider: "openrouter",
      apiUrl: AI_API_URL || "https://openrouter.ai/api/v1/chat/completions",
      apiKey: OPENROUTER_API_KEY || GENERIC_AI_API_KEY || OPENAI_API_KEY,
      model: USER_DEFINED_MODEL || "openai/gpt-4o-mini",
    };
  }

  return {
    provider: "openai",
    apiUrl: AI_API_URL || "https://api.openai.com/v1/chat/completions",
    apiKey: OPENAI_API_KEY || GENERIC_AI_API_KEY || OPENROUTER_API_KEY,
    model: USER_DEFINED_MODEL || "gpt-4o-mini",
  };
};

const AI_RUNTIME = resolveAiRuntimeConfig();

const parseMentionedUser = async (message, raw) => {
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned;

  const cleaned = String(raw || "").replace(/[<@!>]/g, "").trim();
  if (!cleaned) return null;

  const inGuild = message.guild.members.cache.get(cleaned) || await message.guild.members.fetch(cleaned).catch(() => null);
  if (inGuild?.user) return inGuild.user;

  return client.users.fetch(cleaned).catch(() => null);
};

const resolveIqChallengeChannel = async (message) => {
  const configured = getIqChallengeChannelConfigId();
  if (!configured) return null;
  const channel = message.guild.channels.cache.get(configured) || await message.guild.channels.fetch(configured).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
};

const makeChallengeId = (guildId, challengerId, opponentId) => `${guildId}:${challengerId}:${opponentId}:${Date.now()}`;
const makeGameId = (challengeId) => `${challengeId}:game`;

const cleanupPendingChallenge = (challengeId) => {
  const pending = pendingChallenges.get(challengeId);
  if (!pending) return;
  if (pending.timeout) clearTimeout(pending.timeout);
  pendingChallenges.delete(challengeId);
};

const cleanupGame = (game) => {
  if (!game) return;
  if (game.roundTimeout) clearTimeout(game.roundTimeout);
  if (game.nextRoundTimeout) clearTimeout(game.nextRoundTimeout);

  for (const userId of game.players) {
    userToGame.delete(getUserGameKey(game.guildId, userId));
  }

  activeGames.delete(game.id);
};

const optionLetter = (index) => ["A", "B", "C", "D"][index] || "?";

const normalizeIqPacket = (rawPacket, fallbackPacket) => {
  if (!rawPacket || typeof rawPacket !== "object") return fallbackPacket;

  const prompt = String(rawPacket.prompt || "").trim();
  const question = String(rawPacket.question || "").trim() || "Which option is correct?";
  const options = Array.isArray(rawPacket.options)
    ? rawPacket.options.slice(0, 4).map((entry) => String(entry || "").trim())
    : [];
  const answerIndex = Number(rawPacket.answerIndex);
  const reveal = String(rawPacket.answerReveal || "").trim();

  if (!prompt || options.length !== 4 || options.some((entry) => !entry) || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
    return fallbackPacket;
  }

  return {
    prompt,
    question,
    options,
    answerIndex,
    answerReveal: reveal || `The right answer was ${optionLetter(answerIndex)}.`
  };
};

const extractFirstJsonObject = (text) => {
  const input = String(text || "");
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  const candidate = input.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const fallbackReasoningFactory = ({ roundNumber }) => {
  const templates = [
    {
      prompt: "A, C, F, J, O, ?",
      question: "What comes next in the sequence?",
      options: ["U", "T", "V", "S"],
      answerIndex: 0,
      answerReveal: "The letters advance by +2 each time: A→C, C→F, F→J, J→O, so the next is U."
    },
    {
      prompt: "All engineers are problem solvers. Some problem solvers are not coders. Which statement must be true?",
      question: "Which conclusion is logically valid?",
      options: ["All engineers are coders.", "Some engineers are not coders.", "Some coders are engineers.", "All problem solvers are engineers."],
      answerIndex: 1,
      answerReveal: "We know all engineers are problem solvers, and some problem solvers are not coders. This means not all problem solvers are coders, so at least some engineers are not coders."
    },
    {
      prompt: "A clock shows 3:15. The minute hand points to 3 and the hour hand points between 3 and 4. What is the smaller angle between the hands?",
      question: "What is the smaller angle between the hands?",
      options: ["0°", "7.5°", "22.5°", "45°"],
      answerIndex: 1,
      answerReveal: "At 3:15, the minute hand is at 90° and the hour hand is at 97.5°, so the difference is 7.5°. The other choices are distractors."
    },
    {
      prompt: "In a box are 3 red, 4 blue, and 5 green balls. If you pick one without looking, what is the probability it is not blue?",
      question: "What is the chance the ball is not blue?",
      options: ["3/12", "4/12", "8/12", "9/12"],
      answerIndex: 2,
      answerReveal: "There are 12 total balls and 4 blue ones. The non-blue total is 8, so the probability is 8/12 = 2/3."
    },
  ];

  const base = templates[(Math.max(1, roundNumber) - 1) % templates.length];
  return {
    prompt: base.prompt,
    question: base.question,
    options: base.options,
    answerIndex: base.answerIndex,
    answerReveal: base.answerReveal,
  };
};

const generateAiIqPacket = async ({ guildName, challengerTag, opponentTag, roundNumber }) => {
  if (!AI_RUNTIME.apiKey) {
    return fallbackReasoningFactory({ roundNumber });
  }

  const systemPrompt = [
    "You write short IQ and reasoning challenge questions for a Discord duel game.",
    "Output strict JSON only.",
    "Create a clear puzzle suitable for general audience with one correct answer.",
    "Use logic, pattern recognition, arithmetic, word reasoning, or basic deduction.",
    "Keep the prompt concise and easy to understand.",
    "Exactly 4 options and one correct answer.",
    "No sexual content, hate, or graphic violence.",
  ].join(" ");

  const userPrompt = [
    `Guild name: ${guildName || "Unknown"}`,
    `Players: ${challengerTag} vs ${opponentTag}`,
    `Round: ${roundNumber}`,
    "Return JSON with this exact schema:",
    "{",
    "  \"prompt\": \"(the reasoning question or short puzzle, 1 sentence or short clause)\",",
    "  \"question\": \"(what the player must solve)\",",
    "  \"options\": [\"option 1\", \"option 2\", \"option 3\", \"option 4\"],",
    "  \"answerIndex\": 0,",
    "  \"answerReveal\": \"(2-3 sentence explanation why the correct option is right)\"",
    "}",
    "Constraints: use easy but true IQ/reasoning logic, keep clues clear, ensure only one valid answer, answerIndex must be 0-3, no markdown fences.",
  ].join("\n");

  const payload = {
    model: AI_RUNTIME.model,
    temperature: 0.75,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  const response = await fetch(AI_RUNTIME.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_RUNTIME.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`IQ generation request failed (${response.status})`);
  }

  const json = await response.json();
  const content = String(json?.choices?.[0]?.message?.content || "").trim();
  const parsed = extractFirstJsonObject(content);
  return normalizeIqPacket(parsed, fallbackReasoningFactory({ roundNumber }));
};

const buildRoundPayload = (game, packet) => {
  const optionsText = packet.options
    .map((entry, index) => `**${optionLetter(index)}.** ${entry}`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor("#2f3136")
    .setTitle(`🧠 IQ Challenge Round ${game.roundNumber}`)
    .setDescription([
      `Duo: ${userMention(game.players[0])} vs ${userMention(game.players[1])}`,
      "",
      `**Puzzle:** ${packet.prompt}`,
      "",
      `**Question:** ${packet.question}`,
      "",
      optionsText,
      "",
      `⏱️ You both have ${Math.floor(ROUND_TIMEOUT_MS / 1000)} seconds to answer.`,
      `🏆 Winner this round gets **${ROUND_WIN_COINS} quest coins**.`,
      "Either player can press Exit to end the match after this round.",
    ].join("\n"));

  const answerRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${BTN_GUESS}${game.id}:0`).setLabel("A").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${BTN_GUESS}${game.id}:1`).setLabel("B").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${BTN_GUESS}${game.id}:2`).setLabel("C").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${BTN_GUESS}${game.id}:3`).setLabel("D").setStyle(ButtonStyle.Primary),
  );

  const exitRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${BTN_EXIT}${game.id}`).setLabel("Exit Match").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [answerRow, exitRow] };
};

const resolveRoundWinner = (roundData) => {
  const correct = [];
  for (const [userId, answer] of roundData.answers.entries()) {
    if (answer.choiceIndex === roundData.answerIndex) {
      correct.push({ userId, answeredAt: answer.answeredAt });
    }
  }

  if (correct.length === 0) {
    return { winnerId: null, reason: "No correct answers this round." };
  }

  if (correct.length === 1) {
    return { winnerId: correct[0].userId, reason: "Only one player answered correctly." };
  }

  correct.sort((a, b) => a.answeredAt - b.answeredAt);
  return { winnerId: correct[0].userId, reason: "Both were correct; first correct answer wins." };
};

const announceRoundResult = async (game, roundData, resolved) => {
  const correctLabel = `${optionLetter(roundData.answerIndex)}. ${roundData.options[roundData.answerIndex]}`;

  let winnerLine = "No one won this round.";
  if (resolved.winnerId) {
    addQuestCoins(game.guildId, resolved.winnerId, ROUND_WIN_COINS);
    game.scores.set(resolved.winnerId, Number(game.scores.get(resolved.winnerId) || 0) + 1);
    winnerLine = `${userMention(resolved.winnerId)} wins **${ROUND_WIN_COINS}** quest coins.`;
  }

  const balanceA = getQuestCoins(game.guildId, game.players[0]);
  const balanceB = getQuestCoins(game.guildId, game.players[1]);

  const summary = new EmbedBuilder()
    .setColor("#f1c40f")
    .setTitle(`Round ${game.roundNumber} Result`)
    .setDescription([
      `✅ Correct answer: **${correctLabel}**`,
      roundData.answerReveal ? `🔍 ${roundData.answerReveal}` : "",
      "",
      `🏁 ${resolved.reason}`,
      `🏆 ${winnerLine}`,
      "",
      `Score: ${userMention(game.players[0])} **${game.scores.get(game.players[0]) || 0}** - **${game.scores.get(game.players[1]) || 0}** ${userMention(game.players[1])}`,
      `Balances: ${userMention(game.players[0])} **${balanceA}** coins | ${userMention(game.players[1])} **${balanceB}** coins`,
      "",
      `Next round starts in ${Math.floor(BETWEEN_ROUNDS_MS / 1000)} seconds unless someone exits.`,
    ].filter(Boolean).join("\n"));

  await game.challengeChannel.send({ embeds: [summary] }).catch(() => {});
};

const endGame = async (game, reasonText) => {
  if (!game || game.ended) return;
  game.ended = true;

  if (game.roundTimeout) clearTimeout(game.roundTimeout);
  if (game.nextRoundTimeout) clearTimeout(game.nextRoundTimeout);

  const finalA = getQuestCoins(game.guildId, game.players[0]);
  const finalB = getQuestCoins(game.guildId, game.players[1]);

  const finalEmbed = new EmbedBuilder()
    .setColor("#e74c3c")
    .setTitle("🧠 IQ Challenge Ended")
    .setDescription([
      reasonText || "The match has ended.",
      "",
      `Final score: ${userMention(game.players[0])} **${game.scores.get(game.players[0]) || 0}** - **${game.scores.get(game.players[1]) || 0}** ${userMention(game.players[1])}`,
      `Final balances: ${userMention(game.players[0])} **${finalA}** | ${userMention(game.players[1])} **${finalB}** quest coins`,
    ].join("\n"));

  await game.challengeChannel.send({ embeds: [finalEmbed], components: [] }).catch(() => {});
  cleanupGame(game);
};

const settleRoundIfReady = async (game, cause = "answers") => {
  if (!game || game.ended || !game.currentRound) return;

  if (cause === "answers" && game.currentRound.answers.size < 2) {
    return;
  }

  if (game.roundTimeout) {
    clearTimeout(game.roundTimeout);
    game.roundTimeout = null;
  }

  const roundData = game.currentRound;
  game.currentRound = null;

  const resolved = resolveRoundWinner(roundData);
  await announceRoundResult(game, roundData, resolved);

  if (game.ended) return;

  game.nextRoundTimeout = setTimeout(async () => {
    game.nextRoundTimeout = null;
    if (!game.ended) {
      await startNextRound(game);
    }
  }, BETWEEN_ROUNDS_MS);
};

const startNextRound = async (game) => {
  if (!game || game.ended) return;

  game.roundNumber += 1;

  let packet;
  try {
    const challenger = await client.users.fetch(game.players[0]).catch(() => null);
    const opponent = await client.users.fetch(game.players[1]).catch(() => null);

    packet = await generateAiIqPacket({
      guildName: game.guildName,
      challengerTag: challenger?.tag || game.players[0],
      opponentTag: opponent?.tag || game.players[1],
      roundNumber: game.roundNumber,
    });
  } catch (error) {
    console.error("iq challenge generation failed:", error);
    packet = fallbackReasoningFactory({ roundNumber: game.roundNumber });
  }

  game.currentRound = {
    answerIndex: packet.answerIndex,
    answerReveal: packet.answerReveal,
    options: packet.options,
    answers: new Map(),
  };

  const payload = buildRoundPayload(game, packet);
  await game.challengeChannel.send(payload).catch(() => {});

  game.roundTimeout = setTimeout(async () => {
    game.roundTimeout = null;
    await settleRoundIfReady(game, "timeout");
  }, ROUND_TIMEOUT_MS);
};

const startGameFromChallenge = async (challenge) => {
  cleanupPendingChallenge(challenge.id);

  const gameId = makeGameId(challenge.id);
  const game = {
    id: gameId,
    guildId: challenge.guildId,
    guildName: challenge.guildName,
    players: [challenge.challengerId, challenge.opponentId],
    challengeChannel: challenge.challengeChannel,
    roundNumber: 0,
    currentRound: null,
    scores: new Map([
      [challenge.challengerId, 0],
      [challenge.opponentId, 0],
    ]),
    roundTimeout: null,
    nextRoundTimeout: null,
    ended: false,
  };

  activeGames.set(game.id, game);
  userToGame.set(getUserGameKey(game.guildId, game.players[0]), game.id);
  userToGame.set(getUserGameKey(game.guildId, game.players[1]), game.id);

  await challenge.requestChannel.send(
    `${userMention(challenge.opponentId)} accepted the challenge. Match started in ${challenge.challengeChannel}.`
  ).catch(() => {});

  await game.challengeChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor("#3498db")
        .setTitle("🧠 IQ Challenge Started")
        .setDescription([
          `${userMention(challenge.challengerId)} vs ${userMention(challenge.opponentId)}`,
          "Each round has one correct answer out of 4 options.",
          "You will solve logic, reasoning, and IQ-style questions.",
          `Round winner gets **${ROUND_WIN_COINS} quest coins**.`,
          "If both are correct, the first correct answer wins the reward.",
          "Press Exit Match anytime to end the game.",
        ].join("\n")),
    ],
  }).catch(() => {});

  await startNextRound(game);
};

const isUserBusy = (guildId, userId) => {
  const key = getUserGameKey(guildId, userId);
  if (userToGame.has(key)) return true;

  for (const challenge of pendingChallenges.values()) {
    if (challenge.guildId !== guildId) continue;
    if (challenge.challengerId === userId || challenge.opponentId === userId) {
      return true;
    }
  }

  return false;
};

const handleChallengeCommand = async (message) => {
  if (!message.guild || message.author.bot) return;

  const content = String(message.content || "").trim();
  const parts = content.split(/\s+/g);
  if (String(parts[0] || "").toLowerCase() !== PREFIX) return;
  if (String(parts[1] || "").toLowerCase() !== CHALLENGE_WORD) return;

  const sub = String(parts[2] || "").toLowerCase();
  if (sub === "help") {
    await message.reply([
      "Usage:",
      "ct challenge @user",
      "The challenged user can accept or decline via buttons.",
      "This command only works in the dedicated IQ challenge channel set by iqChallengeChannelId in config.json.",
    ].join("\n")).catch(() => {});
    return;
  }

  const target = await parseMentionedUser(message, parts[2]);
  if (!target) {
    await message.reply("Usage: ct challenge @user").catch(() => {});
    return;
  }

  if (target.bot) {
    await message.reply("You can only challenge real users.").catch(() => {});
    return;
  }

  if (target.id === message.author.id) {
    await message.reply("You cannot challenge yourself.").catch(() => {});
    return;
  }

  const iqChannel = await resolveIqChallengeChannel(message);
  if (!iqChannel) {
    await message.reply(
      "I could not resolve the dedicated IQ challenge channel. Set iqChallengeChannelId in config.json."
    ).catch(() => {});
    return;
  }

  if (message.channel.id !== iqChannel.id) {
    await message.reply(`This command only works in ${iqChannel}.`).catch(() => {});
    return;
  }

  if (isUserBusy(message.guild.id, message.author.id)) {
    await message.reply("You already have a pending/active challenge.").catch(() => {});
    return;
  }

  if (isUserBusy(message.guild.id, target.id)) {
    await message.reply("That user already has a pending/active challenge.").catch(() => {});
    return;
  }

  const challengeId = makeChallengeId(message.guild.id, message.author.id, target.id);
  const acceptId = `${BTN_CHALLENGE_ACCEPT}${challengeId}`;
  const declineId = `${BTN_CHALLENGE_DECLINE}${challengeId}`;

  const challengeEmbed = new EmbedBuilder()
    .setColor("#9b59b6")
    .setTitle("🧠 IQ Challenge")
    .setDescription([
      `${userMention(message.author.id)} challenged ${userMention(target.id)} to an IQ reasoning duel.`,
      `Challenge channel: ${iqChannel}`,
      "The challenged user must accept or decline within 90 seconds.",
    ].join("\n"));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(acceptId).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(declineId).setLabel("Decline").setStyle(ButtonStyle.Danger),
  );

  await message.channel.send({
    content: `${userMention(target.id)}, you have been challenged!`,
    embeds: [challengeEmbed],
    components: [row],
  }).catch(() => {});

  const timeout = setTimeout(async () => {
    const pending = pendingChallenges.get(challengeId);
    if (!pending) return;
    cleanupPendingChallenge(challengeId);
    await pending.requestChannel.send("Challenge timed out.").catch(() => {});
  }, CHALLENGE_TIMEOUT_MS);

  pendingChallenges.set(challengeId, {
    id: challengeId,
    guildId: message.guild.id,
    guildName: message.guild.name,
    challengerId: message.author.id,
    opponentId: target.id,
    requestChannel: message.channel,
    challengeChannel: iqChannel,
    timeout,
  });
};

const handleChallengeButtons = async (interaction) => {
  const isAccept = interaction.customId.startsWith(BTN_CHALLENGE_ACCEPT);
  const isDecline = interaction.customId.startsWith(BTN_CHALLENGE_DECLINE);
  if (!isAccept && !isDecline) return false;

  const challengeId = interaction.customId.slice((isAccept ? BTN_CHALLENGE_ACCEPT : BTN_CHALLENGE_DECLINE).length);
  const challenge = pendingChallenges.get(challengeId);
  if (!challenge) {
    await interaction.reply({ content: "This challenge is no longer active.", flags: 64 }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== challenge.opponentId) {
    await interaction.reply({ content: "Only the challenged user can respond.", flags: 64 }).catch(() => {});
    return true;
  }

  if (isDecline) {
    cleanupPendingChallenge(challengeId);
    await interaction.update({
      content: `${userMention(challenge.opponentId)} declined the challenge.`,
      embeds: [],
      components: [],
    }).catch(() => {});
    return true;
  }

  await interaction.update({
    content: `${userMention(challenge.opponentId)} accepted the challenge.`,
    embeds: [],
    components: [],
  }).catch(() => {});

  await startGameFromChallenge(challenge);
  return true;
};

const handleGuessAndExitButtons = async (interaction) => {
  const isGuess = interaction.customId.startsWith(BTN_GUESS);
  const isExit = interaction.customId.startsWith(BTN_EXIT);
  if (!isGuess && !isExit) return false;

  const payload = interaction.customId.slice((isGuess ? BTN_GUESS : BTN_EXIT).length);
  let gameId = payload;
  let rawChoice = null;

  if (isGuess) {
    const splitIndex = payload.lastIndexOf(":");
    if (splitIndex <= 0) {
      await interaction.reply({ content: "Invalid answer button.", flags: 64 }).catch(() => {});
      return true;
    }

    gameId = payload.slice(0, splitIndex);
    rawChoice = payload.slice(splitIndex + 1);
  }

  const game = activeGames.get(gameId);

  if (!game || game.ended) {
    await interaction.reply({ content: "This match is no longer active.", flags: 64 }).catch(() => {});
    return true;
  }

  if (!game.players.includes(interaction.user.id)) {
    await interaction.reply({ content: "Only the two players in this match can use these buttons.", flags: 64 }).catch(() => {});
    return true;
  }

  if (isExit) {
    await interaction.reply({ content: "You exited the match.", flags: 64 }).catch(() => {});
    await endGame(game, `${userMention(interaction.user.id)} exited the game.`);
    return true;
  }

  if (!game.currentRound) {
    await interaction.reply({ content: "This round is already closed.", flags: 64 }).catch(() => {});
    return true;
  }

  if (game.currentRound.answers.has(interaction.user.id)) {
    await interaction.reply({ content: "You already submitted your answer for this round.", flags: 64 }).catch(() => {});
    return true;
  }

  const choiceIndex = Number(rawChoice);
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) {
    await interaction.reply({ content: "Invalid answer button.", flags: 64 }).catch(() => {});
    return true;
  }

  game.currentRound.answers.set(interaction.user.id, {
    choiceIndex,
    answeredAt: Date.now(),
  });

  await interaction.reply({
    content: `Answer locked: **${optionLetter(choiceIndex)}**.`,
    flags: 64,
  }).catch(() => {});

  await settleRoundIfReady(game, "answers");
  return true;
};

const iqChallenge = () => {
  client.on("messageCreate", async (message) => {
    try {
      await handleChallengeCommand(message);
    } catch (error) {
      console.error("iq challenge command error:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    try {
      const handledChallenge = await handleChallengeButtons(interaction);
      if (handledChallenge) return;
      await handleGuessAndExitButtons(interaction);
    } catch (error) {
      console.error("iq challenge interaction error:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong in the challenge flow.", flags: 64 }).catch(() => {});
      }
    }
  });
};

module.exports = iqChallenge;
