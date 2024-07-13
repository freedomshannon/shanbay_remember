import { createRequire } from 'module'
const require = createRequire(import.meta.url);
const https = require("https");
const fs = require("fs");
const { spawn } = require('child_process');
const { Configuration, OpenAIApi } = require("openai");
const { exit } = require("process");
import API from "./api.js";

// *** 1. 从环境变量或配置文件中获取自建 API 的地址和密钥 ***
const yourApiKey = process.env.YOUR_API_KEY || 'sk-CU3Bs2ZS1Tg76BSP2f82D20272314a3bB5E78373F77101Ef'; // 替换为你的实际密钥
const yourApiBase = process.env.YOUR_API_BASE || 'https://api.huida.app/v1'; // 替换为你的实际地址

const args = process.argv.slice(2);

if (args.length < 3) {
  console.log("Please add telegram token,telegram chatId, and shanbay cookie")
  exit()
}
const token = args[0];
const chatId = args[1];
const cookie = args[2];

const api = new API(cookie);


// *** 2. 修改 configuration 对象 ***
const configuration = new Configuration({
  apiKey: yourApiKey, // 使用你的自建 API 密钥
  basePath: yourApiBase, // 使用你的自建 API 基础地址
});
const openai = new OpenAIApi(configuration);

// *** 3.  根据需要修改 chapGPT 函数 ***
//     - 如果你的自建 API 使用了不同的模型名称或参数，
//       你需要相应地修改此函数。 
async function chapGPT(words) {
  const response = await openai.createChatCompletion({
    model: "gemini-1.5-pro-latest", //  模型名称，可能需要修改
    // copy from https://github.com/piglei/ai-vocabulary-builder
    messages: [
      {
        role: "user",
        content: `Please write a short story which is less than 300 words, the story should use simple words and these special words must be included: ${words}. Also surround every special word with a single '*' character at the beginning and the end.`
      }
    ],
  });
  console.log(response["data"]["choices"][0]["message"]["content"]);
  return response["data"]["choices"][0]["message"]["content"]
};


const mp3DirMap = new Map([
  ["NEW", "MP3_NEW"],
  ["REVIEW", "MP3_REVIEW"],
])

const mp3ArticleMap = new Map([
  ["NEW", "new"],
  ["REVIEW", "review"],
])

async function send2telegram(text) {
  const data = JSON.stringify({
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
  });
  const options = {
    hostname: "api.telegram.org",
    port: 443,
    path: "/bot" + token + "/sendMessage",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": data.length,
    },
  };

  const req = https.request(options, (res) => {
    console.log(`statusCode: ${res.statusCode}`);

    res.on("data", () => {
      console.log("succeed");
    });
  });

  req.on("error", (error) => {
    console.error(error);
  });

  req.write(data);
  req.end();
}

async function downloadAudio(audioUrl, audioName, wordsType) {
  const dirName = mp3DirMap.get(wordsType)
  const file = fs.createWriteStream(`${dirName}/${audioName}.audio`);
  return new Promise((resolve, reject) => {
    https.get(audioUrl, function (response) {
      response.pipe(file);
      response.on("end", () => { resolve() });
      response.on("error", (err) => { reject(err) });
    });
  });
}

async function getAndSendResult(materialbookId, wordsType) {
  const totalNew = (await api.getWordsInPageApi(1, materialbookId, wordsType)).total;
  const description = {
    "NEW": "new words",
    "REVIEW": "review words",
  }
  let message = `Today's ${totalNew} ${description[wordsType]}\n`
  let wordsArray = [];
  const wordsObject = await api.getWordsAllApi(materialbookId, wordsType);
  for (let i = 0; i < wordsObject.length; i++) {
    let w = wordsObject[i];
    const wordsName = w.vocab_with_senses.word;
    wordsArray.push(wordsName);
    const audioUrl = w.vocab_with_senses.sound.audio_us_urls[0]
    if (audioUrl)
      await downloadAudio(audioUrl, i, wordsType)
  }

  message += wordsArray.join("\n");
  const cMessage = wordsArray.join(",");
  message += "\n";

  await send2telegram(message);
  const chatGPTMessage = await chapGPT(cMessage)
  // await send2telegram(await chapGPT(chatGPTMessage));
  await send2telegram(chatGPTMessage);
  const articleName = mp3ArticleMap.get(wordsType)
  const child = spawn('edge-tts', ['--text', `"${chatGPTMessage}"`, '--write-media', `${articleName}_article.mp3`]);
  child.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });
  child.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });
  child.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });
}

async function main() {
  const materialbookId = await api.getDefaultMaterialBookIdApi()
  await getAndSendResult(materialbookId, api.WORDS_TYPE.NEW); // new words
  await getAndSendResult(materialbookId, api.WORDS_TYPE.REVIEW); // old words
}

main()
