const STORAGE_KEY = "blueGameDevices";

let devices = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

if (!devices) {
  devices = Array.from({length: 8}, (_, i) => ({
    id: i + 1,
    name: "جهاز " + (i + 1),
    type: "",
    price: 0,
    busy: false,
    session: null
  }));
}

devices.forEach(d => {
  if (d.session === undefined) d.session = null;
  d.busy = !!d.session;
});

function saveDevices() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}

function chooseType() {
  const choice = prompt(
    "اختر نوع الجهاز:\n1 - ثنائي (10000)\n2 - ثلاثي (15000)\n3 - رباعي (18000)"
  );

  const types = {
    "1": {type: "ثنائي", price: 10000},
    "2": {type: "ثلاثي", price: 15000},
    "3": {type: "رباعي", price: 18000}
  };

  return types[choice] || null;
}

function formatTime(seconds) {
  seconds = Math.max(0, seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

function calculatePrice(minutes, hourlyPrice) {
  return Math.ceil(minutes * hourlyPrice / 60);
}

function playAlarm() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();

    [0, 0.5, 1].forEach(delay => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();

      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.frequency.value = 880;
      gain.gain.value = 0.25;

      oscillator.start(audio.currentTime + delay);
      oscillator.stop(audio.currentTime + delay + 0.3);
    });

    setTimeout(() => audio.close(), 2000);
  } catch (e) {
    console.log("تعذر تشغيل المنبه الصوتي");
  }

  if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
}

function startSession(device) {
  if (!device.type || !device.price) {
    alert("حدد نوع الجهاز أولاً");
    return;
  }

  const mode = prompt(
    "اختر نوع الجلسة:\n1 - وقت محدد\n2 - وقت مفتوح"
  );

  if (mode !== "1" && mode !== "2") return;

  const now = Date.now();
  const session = {
    mode: mode === "1" ? "fixed" : "open",
    startedAt: now,
    price: device.price,
    expiredNotified: false
  };

  if (session.mode === "fixed") {
    const hours = Number(prompt("كم ساعة؟", "1"));
    if (!Number.isInteger(hours) || hours < 0) {
      alert("عدد الساعات غير صحيح");
      return;
    }

    const minutes = Number(prompt("كم دقيقة؟", "0"));
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      alert("عدد الدقائق غير صحيح");
      return;
    }

    const totalMinutes = hours * 60 + minutes;

    if (totalMinutes < 1) {
      alert("حدد مدة لا تقل عن دقيقة");
      return;
    }

    session.durationMinutes = totalMinutes;
    session.endsAt = now + totalMinutes * 60000;
    session.fixedAmount = calculatePrice(totalMinutes, device.price);
  }

  device.session = session;
  device.busy = true;

  saveDevices();
  renderDevices();
}

function finishSession(device) {
  if (!device.session) return;

  const session = device.session;
  const elapsedMinutes = Math.max(
    1,
    Math.ceil((Date.now() - session.startedAt) / 60000)
  );

  let amount;
  let durationText;

  if (session.mode === "fixed") {
    amount = session.fixedAmount;
    durationText = session.durationMinutes + " دقيقة (المدة المحددة)";
  } else {
    amount = calculatePrice(elapsedMinutes, session.price);
    durationText = elapsedMinutes + " دقيقة (المدة الفعلية)";
  }

  const confirmed = confirm(
    "إنهاء جلسة " + device.name + "؟\n\n" +
    "نوع الجلسة: " +
    (session.mode === "fixed" ? "وقت محدد" : "وقت مفتوح") +
    "\nالمدة: " + durationText +
    "\nالحساب: " + amount.toLocaleString("en-US") + " ل.س"
  );

  if (!confirmed) return;

  alert(
    "🧾 فاتورة " + device.name + "\n\n" +
    "نوع الجلسة: " +
    (session.mode === "fixed" ? "وقت محدد" : "وقت مفتوح") +
    "\nالمدة: " + durationText +
    "\nسعر الساعة: " + session.price.toLocaleString("en-US") + " ل.س" +
    "\nأجرة البلايستيشن: " + amount.toLocaleString("en-US") + " ل.س"
  );

  device.session = null;
  device.busy = false;

  saveDevices();
  renderDevices();
}

function renderDevices() {
  const container = document.getElementById("devices");
  if (!container) return;

  container.innerHTML = "";

  devices.forEach(device => {
    const card = document.createElement("div");
    card.className = "device " + (device.busy ? "busy" : "free");

    const title = document.createElement("h3");
    title.textContent = "🎮 " + device.name;

    const info = document.createElement("p");
    info.textContent = device.type
      ? device.type + " - " + device.price.toLocaleString("en-US") + " ل.س / ساعة"
      : "لم يتم تحديد النوع";

    const status = document.createElement("p");
    status.textContent = device.busy ? "🔴 مشغول" : "🟢 فارغ";

    card.append(title, info, status);

    if (device.session) {
      const timer = document.createElement("p");
      timer.id = "timer-" + device.id;
      card.appendChild(timer);

      const endButton = document.createElement("button");
      endButton.textContent = "إنهاء الجلسة وإصدار الفاتورة";
      endButton.onclick = () => finishSession(device);
      card.appendChild(endButton);

    } else {
      const typeButton = document.createElement("button");
      typeButton.textContent = device.type
        ? "تغيير نوع الجهاز"
        : "تحديد نوع الجهاز";

      typeButton.onclick = () => {
        const selected = chooseType();
        if (!selected) return;

        device.type = selected.type;
        device.price = selected.price;
        saveDevices();
        renderDevices();
      };

      const startButton = document.createElement("button");
      startButton.textContent = "▶ تشغيل جلسة";
      startButton.style.marginTop = "8px";
      startButton.onclick = () => startSession(device);

      card.append(typeButton, startButton);
    }

    container.appendChild(card);
  });

  const busy = devices.filter(d => d.busy).length;
  document.getElementById("total").textContent = devices.length;
  document.getElementById("busy").textContent = busy;
  document.getElementById("free").textContent = devices.length - busy;

  updateTimers();
}

function updateTimers() {
  devices.forEach(device => {
    const session = device.session;
    if (!session) return;

    const timer = document.getElementById("timer-" + device.id);
    if (!timer) return;

    if (session.mode === "fixed") {
      const remaining = Math.ceil(
        (session.endsAt - Date.now()) / 1000
      );

      if (remaining > 0) {
        timer.textContent = "⏳ الوقت المتبقي: " + formatTime(remaining);
      } else {
        timer.textContent = "🔔 انتهى الوقت المحدد";
        if (!session.expiredNotified) {
          session.expiredNotified = true;
          saveDevices();
          playAlarm();
          alert("🔔 انتهى الوقت المحدد لجلسة " + device.name);
        }
      }
    } else {
      const elapsed = Math.floor(
        (Date.now() - session.startedAt) / 1000
      );
      timer.textContent = "🟢 وقت مفتوح: " + formatTime(elapsed);
    }
  });
}

document.getElementById("addDevice").onclick = () => {
  const name = prompt("اكتب اسم الجهاز الجديد:");
  if (!name || !name.trim()) return;

  const selected = chooseType();
  if (!selected) return;

  devices.push({
    id: Date.now(),
    name: name.trim(),
    type: selected.type,
    price: selected.price,
    busy: false,
    session: null
  });

  saveDevices();
  renderDevices();
};

saveDevices();
renderDevices();
setInterval(updateTimers, 1000);
