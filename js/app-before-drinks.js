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
  if (d.session && !d.session.purchases) d.session.purchases = [];
  d.busy = !!d.session;
});

function saveDevices() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}


function openAppModal(title, content) {
  const overlay = document.createElement("div");
  overlay.className = "app-modal-overlay";
  overlay.innerHTML = `
    <div class="app-modal">
      <h2>${title}</h2>
      <div class="app-modal-content">${content}</div>
      <button class="modal-cancel" data-cancel>إلغاء</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function chooseType() {
  return new Promise(resolve => {
    const modal = openAppModal("🎮 اختر نوع الجهاز", `
      <button class="choice-button" data-type="ثنائي" data-price="10000">
        🎮 ثنائي <strong>10,000 ل.س / ساعة</strong>
      </button>
      <button class="choice-button" data-type="ثلاثي" data-price="15000">
        🎮 ثلاثي <strong>15,000 ل.س / ساعة</strong>
      </button>
      <button class="choice-button" data-type="رباعي" data-price="18000">
        🎮 رباعي <strong>18,000 ل.س / ساعة</strong>
      </button>
    `);

    modal.addEventListener("click", e => {
      const button = e.target.closest("[data-type]");
      if (button) {
        resolve({
          type: button.dataset.type,
          price: Number(button.dataset.price)
        });
        modal.remove();
      }
      if (e.target.closest("[data-cancel]")) {
        resolve(null);
        modal.remove();
      }
    });
  });
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


async function startSession(device) {
  if (!device.type || !device.price) {
    alert("حدد نوع الجهاز أولاً");
    return;
  }

  const mode = await new Promise(resolve => {
    const modal = openAppModal("⏱️ اختر نوع الجلسة", `
      <button class="choice-button" data-mode="fixed">⏳ وقت محدد</button>
      <button class="choice-button" data-mode="open">♾️ وقت مفتوح</button>
    `);
    modal.addEventListener("click", e => {
      const button = e.target.closest("[data-mode]");
      if (button) {
        resolve(button.dataset.mode);
        modal.remove();
      }
      if (e.target.closest("[data-cancel]")) {
        resolve(null);
        modal.remove();
      }
    });
  });

  if (!mode) return;

  const now = Date.now();
  const session = {
    mode,
    startedAt: now,
    price: device.price,
    purchases: [],
    expiredNotified: false
  };

  if (mode === "fixed") {
    const duration = await new Promise(resolve => {
      let hours = 1;
      let minutes = 0;

      const modal = openAppModal("⏳ حدد مدة الجلسة", `
        <div class="time-picker">
          <div class="time-unit">
            <span>الساعات</span>
            <div class="number-controls">
              <button data-change="hours" data-step="1">＋</button>
              <strong id="pick-hours">1</strong>
              <button data-change="hours" data-step="-1">－</button>
            </div>
          </div>
          <div class="time-unit">
            <span>الدقائق</span>
            <div class="number-controls">
              <button data-change="minutes" data-step="5">＋</button>
              <strong id="pick-minutes">00</strong>
              <button data-change="minutes" data-step="-5">－</button>
            </div>
          </div>
          <button class="choice-button" data-confirm-time>تأكيد المدة</button>
        </div>
      `);

      modal.addEventListener("click", e => {
        const change = e.target.closest("[data-change]");
        if (change) {
          const step = Number(change.dataset.step);
          if (change.dataset.change === "hours") {
            hours = Math.max(0, Math.min(24, hours + step));
          } else {
            minutes += step;
            if (minutes > 55) minutes = 0;
            if (minutes < 0) minutes = 55;
          }
          modal.querySelector("#pick-hours").textContent = hours;
          modal.querySelector("#pick-minutes").textContent = String(minutes).padStart(2, "0");
        }

        if (e.target.closest("[data-confirm-time]")) {
          if (hours * 60 + minutes < 1) {
            alert("حدد مدة لا تقل عن دقيقة");
            return;
          }
          resolve({hours, minutes});
          modal.remove();
        }

        if (e.target.closest("[data-cancel]")) {
          resolve(null);
          modal.remove();
        }
      });
    });

    if (!duration) return;

    const totalMinutes = duration.hours * 60 + duration.minutes;
    session.durationMinutes = totalMinutes;
    session.endsAt = now + totalMinutes * 60000;
    session.fixedAmount = calculatePrice(totalMinutes, device.price);
  }

  device.session = session;
  device.busy = true;
  saveDevices();
  renderDevices();
}

function addPurchase(device) {
  const items = [
    {name: "ميلو", price: 5000},
    {name: "شاي", price: 2500},
    {name: "قهوة", price: 4000},
    {name: "ثلاثة بواحد", price: 5000},
    {name: "إندومي", price: 8000},
    {name: "أركيلة - تفاحتين نخلة", price: 20000},
    {name: "أركيلة - علكة", price: 20000},
    {name: "أركيلة - بولو", price: 20000}
  ];

  const menu = items.map((item, i) =>
    (i + 1) + " - " + item.name + " (" +
    item.price.toLocaleString("en-US") + " ل.س)"
  ).join("\\n");

  const choice = Number(prompt("اختر الطلب:\\n" + menu));

  if (!Number.isInteger(choice) || choice < 1 || choice > items.length) {
    alert("اختيار غير صحيح");
    return;
  }

  const quantity = Number(prompt("كم الكمية؟", "1"));

  if (!Number.isInteger(quantity) || quantity < 1) {
    alert("الكمية غير صحيحة");
    return;
  }

  if (!device.session.purchases) device.session.purchases = [];

  const item = items[choice - 1];

  device.session.purchases.push({
    name: item.name,
    price: item.price,
    quantity: quantity
  });

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

      const purchaseButton = document.createElement("button");
      purchaseButton.textContent = "🥤 إضافة مشروب أو أركيلة";
      purchaseButton.style.marginTop = "8px";
      purchaseButton.onclick = () => addPurchase(device);

      const purchasesInfo = document.createElement("p");
      const purchases = device.session.purchases || [];
      const purchasesTotal = purchases.reduce(
        (sum, item) => sum + item.price * item.quantity, 0
      );
      purchasesInfo.textContent = "الطلبات: " + purchases.length +
        " | مجموعها: " + purchasesTotal.toLocaleString("en-US") + " ل.س";

      card.append(purchasesInfo, purchaseButton);

      const endButton = document.createElement("button");
      endButton.style.marginTop = "8px";
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
