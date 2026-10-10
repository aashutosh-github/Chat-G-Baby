import Chat from "../model/chatSchema.js";
import Message from "../model/messageSchema.js";
import User from "../model/userSchema.js";

const summaryChunk = 20;

export const updateSummaryIfNeeded = async chatId => {
  const chat = await Chat.findOne({ _id: chatId });
  if (!chat) {
    throw new Error("No such chat found");
  }

  if (chat.messageCount - chat.summarizedTillMessageNumber < summaryChunk) {
    return;
  }

  const messagesToBeSummarized = await Message.find({ chatId })
    .sort({ createdAt: 1 })
    .skip(chat.summarizedTillMessageNumber)
    .limit(summaryChunk)
    .select("content role")
    .lean();

  if (messagesToBeSummarized.length === 0) return;

  const options = {
    method: "POST",
    headers: {
      "x-api-key": process.env.SCALEDOWN_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: JSON.stringify(messagesToBeSummarized),
      instructions:
        "summarize these chats while including important information.",
      max_tokens: 2000,
    }),
  };

  const getData = await fetch(
    "https://api.scaledown.xyz/summarization/abstractive",
    options,
  );
  if (!getData.ok) {
    throw new Error("AI response failed");
  }

  const result = await getData.json();
  if (!result) {
    throw new Error("Incorrect JSON format for AI response");
  }

  chat.summary = result.summary;
  chat.summaryUpdatedAt = new Date();
  chat.summarizedTillMessageNumber += messagesToBeSummarized.length;

  chat.totalTokens += result.input_tokens;
  await chat.save();

  const user = await User.findById(chat.userId);
  if (user) {
    user.totalTokenUsed += result.input_tokens;
    await user.save();
  }
};
