// ===== Difficulty settings =====
// Each level changes the goal, the time limit, how many drops are dirty,
// how fast drops spawn and fall, and the penalties.
const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    goal: 15,            // points needed to win
    time: 40,            // seconds on the clock
    dirtyChance: 0.15,   // 15% of drops are dirty
    spawnEvery: 900,     // ms between new drops
    fallSlowest: 4.5,    // seconds a drop takes to fall at the start
    fallFastest: 3,      // seconds a drop takes to fall at the end
    dirtyPenalty: 1,     // points lost for tapping a dirty drop
    missPenalty: 0,      // seconds lost when a clean drop hits the ground
    description: '15 points in 40 seconds. Fewer dirty drops, slower fall.'
  },
  normal: {
    label: 'Normal',
    goal: 20,
    time: 30,
    dirtyChance: 0.25,
    spawnEvery: 700,
    fallSlowest: 4,
    fallFastest: 2,
    dirtyPenalty: 2,
    missPenalty: 0,
    description: '20 points in 30 seconds. Dirty drops cost 2 points.'
  },
  hard: {
    label: 'Hard',
    goal: 30,
    time: 30,
    dirtyChance: 0.35,
    spawnEvery: 500,
    fallSlowest: 3,
    fallFastest: 1.4,
    dirtyPenalty: 3,
    missPenalty: 1,
    description: '30 points in 30 seconds. Dirty drops cost 3, and every clean drop you miss costs 1 second!'
  }
};

const CLEAN_POINTS = 1; // points for a clean drop (same on every level)

// ===== Grab elements from the page =====
const gameContainer = document.getElementById('game-container');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const goalEl = document.getElementById('goal');
const timeStat = document.getElementById('time-stat');
const progressFill = document.getElementById('progress-fill');
const progressBar = document.querySelector('.progress');
const messageEl = document.getElementById('message');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const soundBtn = document.getElementById('sound-btn');
const diffButtons = document.querySelectorAll('.diff-btn');
const diffDesc = document.getElementById('diff-desc');
const bestScoreEl = document.getElementById('best-score');
const factEl = document.getElementById('fact');
const dirtyPointsEl = document.getElementById('dirty-points');
const confettiCanvas = document.getElementById('confetti');

// ===== Game state =====
let level = 'normal';               // current difficulty key
let settings = DIFFICULTIES[level]; // current difficulty settings
let score = 0;
let timeLeft = settings.time;
let gameRunning = false;
let spawnTimer = null;
let countdownTimer = null;
let reachedMilestones = [];
let confettiFrame = null;
let soundOn = true;

// ===== Sound effects =====
// Short .wav clips stored in the sounds/ folder
const sounds = {
  collect: new Audio('sounds/collect.wav'),
  dirty: new Audio('sounds/dirty.wav'),
  miss: new Audio('sounds/miss.wav'),
  click: new Audio('sounds/click.wav'),
  win: new Audio('sounds/win.wav'),
  lose: new Audio('sounds/lose.wav')
};

function playSound(name) {
  if (!soundOn) return;
  // cloneNode lets the same sound overlap when the player taps quickly
  const clip = sounds[name].cloneNode();
  clip.volume = 0.6;
  // play() returns a promise; ignore errors (e.g. browser blocked autoplay)
  clip.play().catch(() => {});
}

// ===== Feedback messages =====
const cleanMessages = ['Clean water collected!', 'Nice catch!', 'Every drop counts!', 'Keep it flowing!', 'Great tap!'];
const dirtyMessages = ['Oops, dirty water!', 'Contaminated! Watch out.', 'Avoid the dirty drops!'];

// Milestones are fractions of the goal, so they work on every difficulty.
// Example: on Normal (goal 20), 0.5 means a message at 10 points.
const milestones = [
  { at: 0.25, text: '💧 A quarter full! The jerry can is filling up!' },
  { at: 0.5, text: '💧 Halfway there! Keep going!' },
  { at: 0.75, text: '💧 Almost full! Just a few more drops!' },
  { at: 0.9, text: '💧 So close! Clean water is almost here!' }
];

// Real facts from charity: water, shown on the results screen
const waterFacts = [
  'Nearly 1 in 10 people in the world live without access to clean water.',
  'In rural communities, women and girls walk an average of 111 miles a month to collect water.',
  'When schools get clean water and sanitation, absenteeism drops by 31%.',
  'Diseases from dirty water kill more people every year than all forms of violence, including war.',
  '100% of public donations to charity: water go directly to clean water projects.'
];

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}

function updateScore() {
  scoreEl.textContent = score;
  const percent = Math.min(score / settings.goal, 1) * 100;
  progressFill.style.width = `${percent}%`;
  progressBar.setAttribute('aria-valuenow', Math.round(percent));
}

// ===== Best score (saved in the browser) =====
// localStorage can fail in some browsers (private mode), so we use try/catch
function getBest(levelKey) {
  try {
    return Number(localStorage.getItem(`waterdrop-best-${levelKey}`)) || 0;
  } catch (error) {
    return 0;
  }
}

function saveBest(levelKey, value) {
  try {
    localStorage.setItem(`waterdrop-best-${levelKey}`, value);
  } catch (error) {
    // ignore if storage is not available
  }
}

function showBest() {
  const best = getBest(level);
  bestScoreEl.textContent = best > 0 ? `🏆 Your best on ${settings.label}: ${best}` : '';
}

// ===== Difficulty picker =====
function setDifficulty(newLevel) {
  level = newLevel;
  settings = DIFFICULTIES[level];

  // Highlight the chosen button
  diffButtons.forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.level === level);
  });

  diffDesc.textContent = settings.description;
  overlayText.textContent = `Tap clean drops before they hit the ground. Reach ${settings.goal} points in ${settings.time} seconds to win!`;
  goalEl.textContent = settings.goal;
  dirtyPointsEl.textContent = `−${settings.dirtyPenalty}`; // update the legend
  resetState();
  showBest();
}

diffButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (gameRunning) return; // can't switch in the middle of a game
    playSound('click');
    setDifficulty(btn.dataset.level);
  });
});

// ===== Start the game =====
function startGame() {
  if (gameRunning) return;
  playSound('click');
  resetState();
  gameRunning = true;
  overlay.classList.add('hidden');
  startBtn.disabled = true;
  showMessage(`Go! ${settings.label} mode — tap the clean drops!`, 'good');

  createDrop();
  spawnTimer = setInterval(createDrop, settings.spawnEvery);
  countdownTimer = setInterval(tick, 1000);
}

// Runs once per second
function tick() {
  changeTime(-1);
}

// Adds or removes seconds and checks whether time ran out
function changeTime(amount) {
  timeLeft = Math.max(0, timeLeft + amount);
  timeEl.textContent = timeLeft;
  if (timeLeft <= 5) timeStat.classList.add('warning');
  if (timeLeft <= 0 && gameRunning) endGame(false);
}

// ===== Make a falling drop =====
function createDrop() {
  const isDirty = Math.random() < settings.dirtyChance;

  const drop = document.createElement('div');
  drop.className = `drop ${isDirty ? 'dirty' : 'clean'}`;
  drop.innerHTML = '<div class="drop-shape"></div>';

  // Size scales with the game area so it works on phones and desktops
  const areaWidth = gameContainer.clientWidth;
  const size = Math.max(48, Math.min(70, areaWidth * 0.13));
  drop.style.width = `${size}px`;
  drop.style.height = `${size}px`;
  drop.style.left = `${Math.random() * (areaWidth - size)}px`;

  // Drops speed up as the game goes on: from fallSlowest down to fallFastest
  const progress = (settings.time - timeLeft) / settings.time; // 0 at start, 1 at end
  const fallTime = settings.fallSlowest - (settings.fallSlowest - settings.fallFastest) * progress + Math.random() * 0.6;
  drop.style.animationDuration = `${fallTime}s`;

  drop.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    catchDrop(drop, isDirty);
  });

  // The drop reached the ground without being tapped
  drop.addEventListener('animationend', () => {
    if (!isDirty && gameRunning && !drop.classList.contains('caught')) {
      missDrop(drop);
    }
    drop.remove(); // remove it from the DOM
  });

  gameContainer.appendChild(drop);
}

// ===== A clean drop was missed =====
function missDrop(drop) {
  playSound('miss');

  // Little splash on the ground where it landed
  const splash = document.createElement('span');
  splash.className = 'splash';
  splash.style.left = `${drop.offsetLeft + drop.offsetWidth / 2}px`;
  gameContainer.appendChild(splash);
  setTimeout(() => splash.remove(), 500);

  // On Hard, missing a clean drop costs time
  if (settings.missPenalty > 0) {
    showPopupAt(drop.offsetLeft + drop.offsetWidth / 2 - 16, gameContainer.clientHeight - 60, `−${settings.missPenalty}s`, 'bad');
    showMessage(`A clean drop was wasted! −${settings.missPenalty} second`, 'bad');
    changeTime(-settings.missPenalty);
  }
}

// ===== Player taps a drop =====
function catchDrop(drop, isDirty) {
  if (!gameRunning || drop.classList.contains('caught')) return;
  drop.classList.add('caught');

  if (isDirty) {
    score = Math.max(0, score - settings.dirtyPenalty);
    playSound('dirty');
    showMessage(`${randomItem(dirtyMessages)} −${settings.dirtyPenalty}`, 'bad');
    showPopup(drop, `−${settings.dirtyPenalty}`, 'bad');
    gameContainer.classList.remove('hit-bad');
    void gameContainer.offsetWidth; // restart the shake animation
    gameContainer.classList.add('hit-bad');
  } else {
    score += CLEAN_POINTS;
    playSound('collect');
    showMessage(randomItem(cleanMessages), 'good');
    showPopup(drop, `+${CLEAN_POINTS}`, 'good');
    checkMilestones();
  }

  updateScore();
  // Remove the tapped drop from the DOM after its fade-out
  setTimeout(() => drop.remove(), 200);

  if (score >= settings.goal) endGame(true);
}

// Show a milestone message the first time each one is reached
function checkMilestones() {
  milestones.forEach((m) => {
    const target = Math.ceil(settings.goal * m.at);
    if (score >= target && !reachedMilestones.includes(m.at)) {
      reachedMilestones.push(m.at);
      showMessage(`${m.text} (${score}/${settings.goal})`, 'milestone');
    }
  });
}

// Floating "+1" / "−2" where the drop was tapped
function showPopup(drop, text, type) {
  const dropBox = drop.getBoundingClientRect();
  const areaBox = gameContainer.getBoundingClientRect();
  showPopupAt(dropBox.left - areaBox.left + dropBox.width / 2 - 12, dropBox.top - areaBox.top, text, type);
}

function showPopupAt(x, y, text, type) {
  const popup = document.createElement('span');
  popup.className = `popup ${type}`;
  popup.textContent = text;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  gameContainer.appendChild(popup);
  setTimeout(() => popup.remove(), 700);
}

// ===== End of game =====
function endGame(won) {
  stopTimers();
  gameRunning = false;
  clearDrops();
  startBtn.disabled = false;
  startBtn.textContent = 'Play Again';
  overlay.classList.remove('hidden');

  // Save a new best score for this difficulty
  const isNewBest = score > getBest(level);
  if (isNewBest) saveBest(level, score);
  showBest();

  // Show a real fact about the water crisis
  factEl.textContent = `💡 Did you know? ${randomItem(waterFacts)}`;
  factEl.hidden = false;

  if (won) {
    playSound('win');
    overlayTitle.textContent = '🎉 You filled the jerry can!';
    overlayText.textContent = `You collected ${score} points on ${settings.label} with ${timeLeft} seconds to spare. Clean water changes everything.`;
    showMessage(isNewBest ? 'You win — and that’s a new best! 🎉' : 'You win! Clean water delivered! 🎉', 'good');
    launchConfetti();
  } else {
    playSound('lose');
    overlayTitle.textContent = "Time's up!";
    overlayText.textContent = `You got ${score} of ${settings.goal} points on ${settings.label}. Try again and keep the water clean!`;
    showMessage('So close! Press Play Again or pick a new difficulty.', 'bad');
  }
}

// ===== Reset button =====
function resetGame() {
  playSound('click');
  stopTimers();
  gameRunning = false;
  stopConfetti();
  startBtn.disabled = false;
  startBtn.textContent = 'Start';
  overlayTitle.textContent = 'Ready to bring clean water?';
  factEl.hidden = true;
  setDifficulty(level); // resets the state and the overlay text
  overlay.classList.remove('hidden');
  showMessage('Game reset. Pick a difficulty and press Start!', '');
}

function resetState() {
  score = 0;
  timeLeft = settings.time;
  reachedMilestones = [];
  timeEl.textContent = timeLeft;
  timeStat.classList.remove('warning');
  clearDrops();
  updateScore();
}

function stopTimers() {
  clearInterval(spawnTimer);
  clearInterval(countdownTimer);
  timeStat.classList.remove('warning');
}

function clearDrops() {
  gameContainer.querySelectorAll('.drop, .popup, .splash').forEach((el) => el.remove());
}

// ===== Sound toggle =====
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(!soundOn));
  soundBtn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Unmute sound');
  playSound('click');
});

// ===== Confetti celebration =====
function launchConfetti() {
  const ctx = confettiCanvas.getContext('2d');
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  const colors = ['#FFC907', '#2E9DF7', '#8BD1CB', '#4FCB53', '#FF902A', '#F5402C'];

  const pieces = [];
  for (let i = 0; i < 160; i++) {
    pieces.push({
      x: Math.random() * confettiCanvas.width,
      y: Math.random() * -confettiCanvas.height,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: randomItem(colors),
      speedY: 3 + Math.random() * 4,
      speedX: -1.5 + Math.random() * 3,
      angle: Math.random() * 360,
      spin: -6 + Math.random() * 12
    });
  }

  const startTime = performance.now();
  cancelAnimationFrame(confettiFrame);

  function draw(now) {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    pieces.forEach((p) => {
      p.x += p.speedX;
      p.y += p.speedY;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (now - startTime < 4000) {
      confettiFrame = requestAnimationFrame(draw);
    } else {
      stopConfetti();
    }
  }
  confettiFrame = requestAnimationFrame(draw);
}

function stopConfetti() {
  cancelAnimationFrame(confettiFrame);
  const ctx = confettiCanvas.getContext('2d');
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// ===== Buttons =====
startBtn.addEventListener('click', startGame);
resetBtn.addEventListener('click', resetGame);

// Set up the page with Normal difficulty when it first loads
setDifficulty('normal');
