import { KNOWLEDGE_BASE } from '../data/knowledgeBase.js';

let isOpen = false;
const messages = [];
const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach(fn => fn({ isOpen, messages }));
}

export function openAssistant() {
  isOpen = true;
  if (messages.length === 0) {
    addBotMessage('¡Hola! Soy el asistente virtual de Masa Fácil · El Maracucho. ¿En qué te puedo ayudar hoy?');
  }
  notify();
}

export function closeAssistant() {
  isOpen = false;
  notify();
}

export function toggleAssistant() {
  if (isOpen) closeAssistant();
  else openAssistant();
}

export function addUserMessage(text) {
  messages.push({ role: 'user', content: text });
  notify();
}

export function addBotMessage(text) {
  messages.push({ role: 'bot', content: text });
  notify();
}

function findAnswer(query) {
  const q = query.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  
  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of entry.keywords) {
      const k = kw.toLowerCase();
      if (k === q) {
        score += 10;
      } else if (k.includes(q) || q.includes(k.replace(/[¿?]/g, ''))) {
        score += 5;
      } else {
        const words = q.split(/\s+/);
        const kwWords = k.replace(/[¿?]/g, '').split(/\s+/);
        for (const w of words) {
          if (w.length > 2 && kwWords.some(kw => kw.includes(w) || w.includes(kw))) {
            score += 1;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }
  
  if (bestMatch && bestScore > 0) {
    return bestMatch.answer;
  }
  
  return 'No tengo esa información exacta en este momento. ¿Te gustaría hablar con una persona por WhatsApp para que te ayuden con tu consulta?';
}

export function sendMessage(query) {
  const text = query.trim();
  if (!text) return;
  
  addUserMessage(text);
  
  setTimeout(() => {
    const answer = findAnswer(text);
    addBotMessage(answer);
  }, 400);
}

export function askHuman() {
  const msg = encodeURIComponent('Hola Masa Fácil, necesito hablar con una persona sobre una consulta.');
  window.open(`https://wa.me/584244099610?text=${msg}`, '_blank');
}

export function getMessages() {
  return messages;
}

export function isAssistantOpen() {
  return isOpen;
}
