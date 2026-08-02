import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const projectDir = process.argv[2];
const piEntry = process.argv[3];
if (!projectDir || !piEntry) process.exit(2);
const piDir = path.join(projectDir, ".pi");
const tasksFile = path.join(piDir, "tasks.json");
const pidFile = path.join(piDir, "scheduler.pid");
const logFile = path.join(piDir, "scheduler.log");
fs.mkdirSync(piDir, { recursive: true });
fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
const log = (message) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
const load = () => { try { const value = JSON.parse(fs.readFileSync(tasksFile, "utf8")); return Array.isArray(value) ? value : []; } catch { return []; } };
const save = (tasks) => fs.writeFileSync(tasksFile, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
const nextRecurring = (task, now) => {
	const parts = String(task.cronExpression ?? "").trim().split(/\s+/);
	if (parts.length < 5) return new Date(now + 3_600_000).toISOString();
	const [minute, hour] = parts;
	const date = new Date(now);
	date.setSeconds(0, 0);
	if (/^\*\/\d+$/.test(minute)) {
		const step = Number(minute.slice(2));
		date.setMinutes(date.getMinutes() + (step - date.getMinutes() % step || step));
		return date.toISOString();
	}
	const targetMinute = Number(minute);
	const targetHour = Number(hour);
	if (Number.isInteger(targetMinute) && Number.isInteger(targetHour)) {
		date.setHours(targetHour, targetMinute, 0, 0);
		if (date.getTime() <= now) date.setDate(date.getDate() + 1);
		return date.toISOString();
	}
	return new Date(now + 3_600_000).toISOString();
};
const runTask = (task) => new Promise((resolve) => {
	const child = spawn(process.execPath, [piEntry, "--no-session", "--print", task.prompt], { cwd: projectDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
	const output = [];
	const errors = [];
	child.stdout.on("data", (chunk) => output.push(chunk));
	child.stderr.on("data", (chunk) => errors.push(chunk));
	child.on("close", (code) => {
		log(`task=${task.id} code=${code} output=${Buffer.concat(output).toString("utf8").trim().slice(0, 2000)} error=${Buffer.concat(errors).toString("utf8").trim().slice(0, 1000)}`);
		resolve();
	});
});
let running = false;
const tick = async () => {
	if (running) return;
	running = true;
	try {
		const now = Date.now();
		const tasks = load();
		let changed = false;
		for (const task of tasks) {
			if (!task.enabled || !task.nextRun || Date.parse(task.nextRun) > now) continue;
			await runTask(task);
			task.lastRun = new Date().toISOString();
			if (task.schedule === "once") task.enabled = false;
			else task.nextRun = nextRecurring(task, Date.now());
			changed = true;
		}
		if (changed) save(tasks);
	} catch (error) { log(`tick-error=${error instanceof Error ? error.message : String(error)}`); }
	finally { running = false; }
};
const shutdown = () => { try { fs.unlinkSync(pidFile); } catch {} process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
log("scheduler-started");
await tick();
setInterval(tick, 15_000);
