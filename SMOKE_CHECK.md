# Quick check after deploy (about 10 minutes)

Deploy first:

```bash
cd ~/dograh && git pull && ~/deploy.sh api && ~/deploy.sh vocalis
```

Tick each one. If one fails, send a screenshot (or the log line) and say which number.

- [ ] **1. Create an agent.** Home page: type a business (or paste a website), pick Hinglish. The agent appears, first line is in Hinglish.
- [ ] **2. Talk to it.** Press Talk on that agent. You hear it and it answers.
- [ ] **3. Voices.** Agent > Voice tab: press play on a Falcon voice and a Swarvo voice. Both play.
- [ ] **4. Knowledge.** Knowledge page: add a short text, wait a few seconds, it shows Ready (not "Needs a look"). Type a question in "Test a question": you get an answer from it.
- [ ] **5. Tools and integrations.** Open the page, connect one service you actually use. It shows Connected.
- [ ] **6. Phone number.** Phone Numbers: a number is attached to the agent. Call it from your phone, the agent picks up.
- [ ] **7. Campaign.** Campaigns: make one with 1 contact (your own number), start it. Your phone rings.
- [ ] **8. Mic.** Home page: tap the mic and speak for 15 seconds without stopping. It keeps listening.

If the Knowledge check fails, run this and send me the lines:

```bash
sudo docker logs --tail 100 dograh-api-1 | grep -i "document\|embedding"
```
