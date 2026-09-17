/**
 * client-tools.js
 * On-device client tools definition and execution dispatcher for AgentCy.
 * These actions execute 100% on the user's phone and NEVER leave the device.
 */

/* exported CLIENT_TOOLS, executeClientTool */

const CLIENT_TOOLS = [
  {
    name: "set_theme",
    description: "Switch between light and dark visual themes on the phone.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["light", "dark"],
          description: "The visual theme mode: 'light' or 'dark'"
        }
      },
      required: ["mode"]
    }
  },
  {
    name: "create_reminder",
    description: "Schedule a local reminder or alarm on the user's phone.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the reminder is for" },
        time: { type: "string", description: "Time or date for the reminder (e.g. 8pm, tomorrow morning)" },
        notes: { type: "string", description: "Optional extra details" }
      },
      required: ["title"]
    }
  },
  {
    name: "save_note",
    description: "Save a quick personal note, grocery item, or recipe snippet to local storage.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title or subject of the note" },
        content: { type: "string", description: "The content of the note" }
      },
      required: ["content"]
    }
  },
  {
    name: "read_notes",
    description: "Read or view saved personal notes or grocery items from local storage.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional filter or search term for the notes" }
      }
    }
  },
  {
    name: "clear_chat",
    description: "Clear the current chat log or start a fresh new conversation.",
    parameters: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "Confirmation to clear conversation" }
      }
    }
  }
];

/**
 * Executes a client-side tool directly in the browser.
 * @param {string} name - Name of the tool
 * @param {object} args - Arguments extracted by Needle
 * @returns {Promise<{ handled: boolean, message: string }>}
 */
async function executeClientTool(name, args = {}) {
  switch (name) {
    case "set_theme": {
      const mode = args.mode === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', mode);
      localStorage.setItem('agentcy_theme', mode);
      const meta = document.getElementById('themeColorMeta');
      if (meta) meta.setAttribute('content', mode === 'light' ? '#f8fafc' : '#090d16');
      const icon = document.getElementById('themeIcon');
      if (icon) icon.innerText = mode === 'light' ? '🌙' : '☀️';
      return {
        handled: true,
        message: `Switched to **${mode}** mode.`
      };
    }

    case "create_reminder": {
      const title = args.title || "Reminder";
      const timeStr = args.time ? ` for ${args.time}` : "";
      const savedReminders = JSON.parse(localStorage.getItem('agentcy_reminders') || '[]');
      const newReminder = {
        id: Date.now(),
        title,
        time: args.time || "Unspecified",
        notes: args.notes || "",
        created: new Date().toISOString()
      };
      savedReminders.push(newReminder);
      localStorage.setItem('agentcy_reminders', JSON.stringify(savedReminders));

      // Attempt web notification if permission granted
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification("Reminder Set", {
            body: `${title}${timeStr}`,
            icon: '/icon.svg'
          });
        } catch (e) {}
      }

      return {
        handled: true,
        message: `Scheduled local reminder: **${title}**${timeStr}.`
      };
    }

    case "save_note": {
      const title = args.title || "Quick Note";
      const content = args.content || "";
      const savedNotes = JSON.parse(localStorage.getItem('agentcy_notes') || '[]');
      savedNotes.push({
        id: Date.now(),
        title,
        content,
        date: new Date().toLocaleDateString()
      });
      localStorage.setItem('agentcy_notes', JSON.stringify(savedNotes));
      return {
        handled: true,
        message: `Saved note **"${title}"**: ${content}`
      };
    }

    case "read_notes": {
      const savedNotes = JSON.parse(localStorage.getItem('agentcy_notes') || '[]');
      if (savedNotes.length === 0) {
        return {
          handled: true,
          message: "You don't have any saved notes yet. You can say *\"Save note: Buy milk\"* anytime!"
        };
      }
      const list = savedNotes.map((n, i) => `${i + 1}. **${n.title}**: ${n.content} *(${n.date})*`).join('\n');
      return {
        handled: true,
        message: `Here are your saved notes:\n\n${list}`
      };
    }

    case "clear_chat": {
      const newChatBtn = document.getElementById('newChatBtn');
      if (newChatBtn) {
        newChatBtn.click();
      }
      return {
        handled: true,
        message: "Started a fresh conversation."
      };
    }

    default:
      return {
        handled: false,
        message: "Unknown tool"
      };
  }
}

// Export for Node testing or browser window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CLIENT_TOOLS, executeClientTool };
}
