import 'dotenv/config';
import axios from "axios";
import { Telegraf } from "telegraf";
import { GoogleGenAI } from "@google/genai";

const bot = new Telegraf(process.env.TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = "gemini-2.5-flash";
const Url = process.env.Url;

const fetchData = async (queryParam) => {
    const res = await axios.get(`${Url + queryParam}`);
    return res.data;
};

const extractCoordinates = async (userText) => {
    const prompt = `
    You are a precise geocoding assistant. 
    Analyze the user's text and find the city, state, region, or country they are talking about.
    Find the exact GPS coordinates (Latitude and Longitude) of this location. 
    If the user mentions a state, region, or country (like "Massachusetts" or "Массачусетс"), return the coordinates of its capital or main central city (e.g., Boston for Massachusetts).
    
    Return ONLY a JSON object with keys:
    1. "coordinates" (string "latitude,longitude", e.g., "42.3601,-71.0589" or "50.4501,30.5234")
    2. "cityName" (string, standard official name of the location or its center in Ukrainian, e.g., "Массачусетс (Бостон)", "Львів", "Київ").
    
    No other words, no markdown formatting outside of JSON, no spaces outside the structure. 
    
    If there is absolutely no location name in the user's text, reply ONLY with the word "None".
    
    User text: "${userText}"
    `;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
        });
        
        const responseText = response.text.trim();
        if (responseText === "None") return null;
        
        const cleanJsonString = responseText.replace(/```json|```/g, "").trim();
        return JSON.parse(cleanJsonString); 
    } catch (e) {
        console.error("Помилка визначення координат через Gemini:", e);
        return null;
    }
};

bot.start((ctx) => {
    ctx.reply("Привіт! Я - твій віртуальний синоптик. Кудись збираєшся йти сьогодні?");
});

bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text;

    await ctx.sendChatAction('typing');

    try {
        const geoData = await extractCoordinates(userMessage);

        if (!geoData || !geoData.coordinates) {
            return ctx.reply("Я не зміг знайти назву міста чи регіону у твоєму повідомленні. Спробуй написати чіткіше, наприклад: 'Яка зараз погода в Харкові?' або 'Що там з погодою в Массачусетсі?'");
        }

        const coordinates = geoData.coordinates;
        const userCity = geoData.cityName;

        console.log(`Знайдені координати: ${coordinates} для локації: ${userCity}`);

        const data = await fetchData(coordinates);

        if (data.success === false || !data.current) {
            return ctx.reply("Не вдалося отримати погоду за цими координатами. Спробуй ще раз.");
        }

        const { current, location } = data;
        const weatherStatus = current?.weather_descriptions?.[0] || "No description";
        const temperature = current?.temperature;

        await ctx.sendChatAction('typing');

        const finalPrompt = `
        You are a helpful local weather assistant.
        I will give you raw weather data from coordinates. Translate everything to Ukrainian, and write a beautifully formatted Telegram message.
        
        Raw Data:
        - Target Location Name: ${userCity}
        - Country detected by API: ${location?.country}
        - Coordinates used: ${coordinates}
        - Temperature: ${temperature}°C
        - Weather condition: ${weatherStatus}

        Your output format MUST be strictly like this (keep the asterisks for bold text):
        *Місто:* ${userCity}, [Translated Country Name] (📍 [Coordinates])
        *Температура:* ${temperature}°C
        *Погода:* [Translated Weather condition (e.g., Хмарно, Ясно, Дощ)]

        *Порада від мене:*
        [Write a friendly, 2-3 sentence advice in Ukrainian about what to wear today based on this weather and temperature. Mention if they need an umbrella, warm coat, sunglasses etc.]
        
        Do not include any other text, greetings, or system remarks. Use appropriate emojis.
        `;

        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: finalPrompt,
        });

        const formattedReply = response.text.trim();
        await ctx.reply(formattedReply, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error("Помилка під час обробки запиту:", error);
        ctx.reply("Ой, щось пішло не так. Спробуй, будь ласка, пізніше.");
    }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
