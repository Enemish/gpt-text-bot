require('dotenv').config();
const OpenAI = require('openai');
const axios = require('axios');

const config = require("./config.json");
const { Telegraf } = require('telegraf');
const { Markup } = require('telegraf');
const { message } = require('telegraf/filters');

const TELEGRAM_TOKEN = config.TELEGRAM_TOKEN;
const bot = new Telegraf(TELEGRAM_TOKEN, {handlerTimeout: 9_000_000});

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});
const OPENAI_API_URL = "https://api.openai.com/v1/engines/davinci/completions";

/* ПЕРЕМЕННЫЕ */
let awaitingRewrite = {}; // Хранилище для отслеживания пользователей, ожидающих рерайтинг
const userContexts = [];//Контекст ChatGPT
let textsByUser = {};
const userData = {};//данные пользователя
let usersInRewriteProcess = {};//Отслеживание процесса рерайта

let tempMsgCnt;
let tempMsgCntId;

let numAtt = 1;

/* ПЕРЕМЕННЫЕ */

/* FUNCTIONS */
// rewrite function
async function rewriteText(rewrittenText, userId) {
  const usersAwaitingRewrite = Object.values(awaitingRewrite).filter(value => value).length;// Подсчет пользователей, которые ожидают рерайтинг
  console.log(`Количество пользователей, ожидающих рерайтинг: ${usersAwaitingRewrite}`);
  try {

    const prompt = `Преобразуй следующий текст так, чтобы он был не только строгим (новостной стиль) и кратким (близким по количеству символов к изначальному тексту, но не более 1000 символов), но и уникальным, креативным и интересным. Сохрани при этом основной смысл оригинала. Твоя задача - сделать его максимально отличным от исходного, но при этом понятным и логичным, избегая излишних эмоций:\n${rewrittenText}`;
    
    if (!userContexts[userId]) {
      userContexts[userId] = [];
    }
  
    userContexts[userId].push({
      "role": "user",
      "content": prompt
    });
    
    console.log("Starting OpenAI request...");
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: userContexts[userId],
      temperature: 0.2,
      max_tokens: 4096,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    }, {
      headers: {
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
      }
    });
    console.log("Finished OpenAI request.");
    
    return response.choices[0].message.content;
  } catch (error) {
      console.error('Error rewriting text:', error);
      return "Произошла ошибка при рерайтинге текста.";
  }
}
//checkUniqueness functions
async function checkUniqueness(rewrittenText, userId) {
  // Задержка на 1 минуту перед выполнением основного кода
  /* await delay(60000); */
  try {
    
    if (!userContexts[userId]) {
      userContexts[userId] = [];
    }
    // Check text.ru
    const API_URL = 'https://api.text.ru/post';
    const TEXT_TO_CHECK = rewrittenText ; // Замените на ваш текст для проверки
    
    const requestData = {
        userkey: config.TEXT_API_KEY, // Ваш API ключ
        text: TEXT_TO_CHECK,
        method: 'check_text_unic'
    };
    
    const responseText = await fetch(API_URL, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    const data = await responseText.json();
    const textUid = data.text_uid; // Уникальный идентификатор текста
    
    async function getCheckResult(textUid, maxAttempts = 100, delay = 5000) {
      let attempts = 0;
  
      while (attempts < maxAttempts) {
        const requestDataResult = {
          userkey: config.TEXT_API_KEY,
          uid: textUid,
          method: 'get_check_result'
        };
  
          const resultResponse = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestDataResult)
          });
  
          const resultData = await resultResponse.json();
  
          if (resultData && !resultData.error_code) {
              return resultData; // Если ответ успешный, возвращаем данные
          } else if (resultData.error_code === 181) {
              // Если текст еще не проверен, ждем и пытаемся снова
              await new Promise(resolve => setTimeout(resolve, delay));
              attempts++;
          } else {
              throw new Error(`Ошибка от text.ru: ${resultData.error_desc}`);
          }
      }
      throw new Error('Превышено максимальное количество попыток получения результата.');
    } 
  
    // Использование:
    let resultData;
    try {
        resultData = await getCheckResult(textUid);
        console.log(resultData);
    } catch (error) {
        console.error(error.message);
    }

    return resultData.text_unique;// ответ от text.ru процент строкой
    
  } catch (error) {
      console.error('Error checking uniqueness:', error);
      return "Произошла ошибка при проверке уникальности текста.";
  }
}
/* async function checkUniquenessWithRetry(rewrittenText, userId, maxRetries) {
  for (let i = 0; i < maxRetries; i++) {
      try {
          const result = await checkUniqueness(rewrittenText, userId);
          return result; // Если запрос успешен, вернуть результат
      } catch (error) {
          console.error(`Attempt ${i + 1} failed. Retrying in 60 seconds...`);
          if (i !== maxRetries - 1) { // Если это не последняя попытка, добавить задержку
          } else { // Если это последняя попытка и она тоже не удалась
              throw new Error('Failed after multiple retries');
          }
      }
  }
} */
/* function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
} */
const getUniquenessButton = (textUid) => {
  return Markup.inlineKeyboard([
    Markup.button.callback('🔵 ПОКАЗАТЬ ТЕКСТ 🔵', `showText_${textUid}`)
  ]);
};
const getUniquenessButtonHide = (textUid) => {
  return Markup.inlineKeyboard([
    Markup.button.callback('🔴 СКРЫТЬ ТЕКСТ 🔴', `hideMessage_${textUid}`)
  ]);
};
const getContinueButton = () => {
  return Markup.inlineKeyboard([
      Markup.button.callback('🟢 ПРОДОЛЖИТЬ REWRITE 🟢', 'continueRewrite')
  ]);
};
function generateUid(length = 10) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
/* FUNCTIONS */

/* СОБЫТИЯ */
bot.command('start', (ctx) => {  
  ctx.reply("Здравствуйте! Рад приветствовать вас! Чем я могу быть вам полезен?");
});
bot.command('rewrite', (ctx) => {
  console.log('Команда рерайт принята');
  const chatId = ctx.chat.id;
  awaitingRewrite[chatId] = true;
  ctx.reply("Готов принять текст на рерайт. Пожалуйста, отправьте текст.");
});
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  if (userContexts[userId]) {
      userContexts[userId] = [
          {
              "role": "system",
              "content": "Здравствуйте! Рад приветствовать вас! Чем я могу быть вам полезен? \n"
          }
      ];
      ctx.reply('Контекст успешно очищен.');
  } else {
      ctx.reply('У вас ещё нет контекста для очистки.');
  }
});
bot.command('delete', async(ctx) => {
  console.log('Команда "delete" вызвана');
  
  const userId = ctx.from.id;
  console.log('ID пользователя:', userId);
  
  userData[userId] = {
    originText:"",
    rewrittenText: "",
    awaitingRewrite: false,
    tempMsgCntId: null,
    numAtt: 0,
    textUid: null,//Уникальный номер рерайт текста
    textsByUser:[], // Инициализируем как объект, а не строку,
  };//Удаляем данные пользователя
  
  let res = await ctx.reply('deleting');
  console.log(res);

  const maxErrors = 30; // Максимальное количество ошибок перед остановкой
  const maxMessagesToDelete = 100; // Максимальное количество сообщений для удаления
  let errorCount = 0;

  for(let i = res.message_id; i >= res.message_id - maxMessagesToDelete && errorCount < maxErrors; i--) {//Удаляем всю переписку из чата
    console.log(`chat_id: ${userId}, message_id: ${i}`);
    try {
      let res = await ctx.telegram.deleteMessage(userId, i);
      console.log(res);
    } catch (e) {
      console.error(e);
      errorCount++;
    }
  }
  console.log('История пользователя удалена');

  if (textsByUser[userId]) {
      delete textsByUser[userId];//Удаляем все тексты пользователя
      console.log('Тексты пользователя удалены');
  } else {
      console.log('У пользователя нет текстов для удаления');
  }
  
  if (userContexts[userId]) {//Удаляем весь контекст
      delete userContexts[userId];
      console.log('Контекст пользователя был успешно удален');
  } else {
      console.log('У пользователя нет контекста для удаления');
  }

  console.log(userData);
  console.log(userContexts);
  console.log(textsByUser);
  ctx.reply('История и контекст были успешно удалены.');
});
bot.action(/showText_(.+)/, async (ctx) => {
  try {
    const userId = ctx.from.id; // Получаем ID пользователя
    const textUid = ctx.match[1]; // Используем захваченное значение textUid из callback query
    const text = userData[userId].textsByUser[textUid];

    if (!text) {
      throw new Error("Text not found");
    }

    ctx.answerCbQuery(); // Закрыть уведомление о нажатии кнопки
    ctx.reply(text, getUniquenessButtonHide(textUid));
  } catch (error) {
    console.error("Error showing text:", error);
    ctx.answerCbQuery("‼️ Текст был удален из архива бота ‼️");
  }
});
bot.action(/hideMessage_(.+)/, async (ctx) => {
  try {
    await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
    ctx.answerCbQuery(); // Закрыть уведомление о нажатии кнопки
  } catch (error) {
    console.error("Error hiding message:", error);
    ctx.answerCbQuery("‼️ Текст был удален из архива бота ‼️");
  }
});
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (!userData[userId]) {
      userData[userId] = {
        originText:"",
        rewrittenText: "",
        awaitingRewrite: false,
        tempMsgCntId: null,
        numAtt: 0,
        textUid: null,//Уникальный номер рерайт текста
        textsByUser:[], // Инициализируем как объект, а не строку,
      };
    }

    if (usersInRewriteProcess[userId]) {
      // Если пользователь находится в процессе рерайта, отправьте ему сообщение и прекратите обработку
      ctx.reply("Пожалуйста, подождите завершения текущего процесса Rewrite.");
      return;
    }

    if (awaitingRewrite[userId]) { // Проверяем, ожидает ли пользователь рерайтинг
      
      console.log(awaitingRewrite);
            
      userData[userId].originText = ctx.message.text;
      
      let tempMsg = await ctx.reply('Процесс Rewrite запущен! Ожидайте...'); // Отправляем временное сообщение
      let tempMsgId = tempMsg.message_id;

      usersInRewriteProcess[userId] = true; // Устанавливаем значение перед началом рерайта

      rewriteText(userData[userId].originText, userId).then(async (newRewrittenText) => {
        userData[userId].rewrittenText = await newRewrittenText;
        
        console.log("Generating UID...");
        userData[userId].textUid = generateUid(); // уникальный номер рерайт текста юзера
        console.log("Generated UID:", userData[userId].textUid );
        
        
        userData[userId].textsByUser[userData[userId].textUid] = userData[userId].rewrittenText;// Добавляем рерайт текст в объект пользователя
        console.log(userData[userId].textsByUser[userData[userId].textUid]);
  
        let uniquenessResult = await checkUniqueness(userData[userId].rewrittenText, userId);
        let uniquenessResultNum = Number(uniquenessResult);
        userData[userId].numAtt++; //счетчик вариантов
        
        await ctx.reply(`Вариант: ${userData[userId].numAtt}\nТекст переформулирован\nУникальность текста: ${uniquenessResultNum}%`, getUniquenessButton(userData[userId].textUid));
        await ctx.deleteMessage(tempMsgId);
        
        tempMsgCnt = await ctx.reply(`Продолжаем процесс Rewrite?`, getContinueButton());
        tempMsgCntId = tempMsgCnt.message_id;
        
        userContexts[userId] = [];//Сбросили контекст
        usersInRewriteProcess[userId] = false; // Сбросьте значение после завершения рерайта
        awaitingRewrite[userId] = false;//закрыли очередь ожидания рерайта
        console.log(userData[userId]);
      }).catch(error => {
        console.error("Error during rewrite:", error);
        usersInRewriteProcess[userId] = false; // Сбросьте значение в случае ошибки
        awaitingRewrite[chatId] = false;
      });
    } else {
      let userMessage = ctx.message.text;
      // Логика свободной генерации (работа с OpenAI и т.д.)
      if (!userContexts[userId]) {
        userContexts[userId] = [];
      }
      userContexts[userId].push({
        "role": "user",
        "content": userMessage
      });

      // Отправляем временное сообщение
      const tempMsg = await ctx.reply('Генерирую ответ...');
      const tempMsgId = tempMsg.message_id;

      const response = await openai.chat.completions.create({
          model: "gpt-4",
          messages: userContexts[userId],
          temperature: 0.2,
          max_tokens: 4096,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
      });

      const reply = response.choices[0].message.content;
      const tokensUsed = response.usage.total_tokens;

      userContexts[userId].push({
        "role": "assistant",
        "content": reply
      });

      // Удаляем временное сообщение
      await ctx.deleteMessage(tempMsgId);
      ctx.reply(reply + `\n\nИспользовано токенов: ${tokensUsed}`);
    }

  } catch (error) {
    console.error('Произошла ошибка:', error);
    ctx.reply('Извините, произошла ошибка. Попробуйте позже.');
  }     
});
bot.action('continueRewrite', async (ctx) => {
  const userId = ctx.from.id;
  console.log(userData[userId]);    
  // Проверяем, есть ли информация о пользователе
  if (!awaitingRewrite.hasOwnProperty(userId)) {
    ctx.answerCbQuery("‼️ Пожалуйста, начните процесс Rewrite сначала ‼️");
    return; // Завершаем выполнение функции
  }
  ctx.answerCbQuery();
  // Kод для продолжения рерайта
  // Удаляем временное сообщение
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, tempMsgCntId);
  } catch (err) {
    console.error("Could not delete message: ", err);
  }

  let tempMsg = await ctx.reply('Процесс Rewrite запущен! Ожидайте...');
  const tempMsgId = tempMsg.message_id;

  console.log("Starting rewriteText...");
  
  usersInRewriteProcess[userId] = true; // Устанавливаем значение перед началом рерайта
  awaitingRewrite[userId] = true;
  
  console.log("Текст на следующий круг рерайта:" , userData[userId].rewrittenText);

  rewriteText(userData[userId].rewrittenText, userId).then(async (newRewrittenText) => {
    userData[userId].rewrittenText = await newRewrittenText;

    userData[userId].textUid = generateUid(); // уникальный номер рерайт текста юзера

    userData[userId].textsByUser[userData[userId].textUid] = userData[userId].rewrittenText; // Добавляем рерайт текст в объект пользователя
    console.log(userData[userId].textsByUser[userData[userId].textUid]);

    let uniquenessResult = await checkUniqueness(userData[userId].rewrittenText, userId);
    let uniquenessResultNum = Number(uniquenessResult);
    userData[userId].numAtt++; //счетчик вариантов
    
    await ctx.reply(`Вариант: ${userData[userId].numAtt}\nТекст переформулирован\nУникальность текста: ${uniquenessResultNum}%`, getUniquenessButton(userData[userId].textUid));
    await ctx.deleteMessage(tempMsgId);
    
    tempMsgCnt = await ctx.reply(`Продолжаем процесс Rewrite?`, getContinueButton());
    tempMsgCntId = tempMsgCnt.message_id;
    userContexts[userId] = [];//Сбросили контекст
    usersInRewriteProcess[userId] = false; // Сбросьте значение после завершения рерайта
    awaitingRewrite[userId] = false;//закрыли очередь ожидания рерайта
    console.log(userData[userId]);
  }).catch(error => {
    console.error("Error during rewrite:", error);
    usersInRewriteProcess[userId] = false; // Сбросьте значение в случае ошибки
    awaitingRewrite[userId] = false;//закрыли очередь ожидания рерайта
  });
});

/* СОБЫТИЯ */

bot.launch();


/* Реализовать полноценное удаление истории сообщений (сейчас удаляет только несколько сообщений и виснет)*/
