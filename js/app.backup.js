const STORAGE_KEY = "blueGameDevices";

let devices = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

if (!devices) {
  devices = Array.from({length: 8}, (_, i) => ({
    id: i + 1,
    name: "جهاز " + (i + 1),
    type: "",
    price: 0,
    busy: false
  }));
  saveDevices();
}

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

    const button = document.createElement("button");
    button.textContent = "تحديد نوع الجهاز";

    button.onclick = () => {
      const selected = chooseType();
      if (!selected) {
        alert("لم يتم اختيار نوع صحيح");
        return;
      }

      device.type = selected.type;
      device.price = selected.price;
      saveDevices();
      renderDevices();
    };

    card.append(title, info, status, button);
    container.appendChild(card);
  });

  const busy = devices.filter(d => d.busy).length;
  document.getElementById("total").textContent = devices.length;
  document.getElementById("busy").textContent = busy;
  document.getElementById("free").textContent = devices.length - busy;
}

document.getElementById("addDevice").onclick = () => {
  const name = prompt("اكتب اسم الجهاز الجديد:");
  if (!name || !name.trim()) return;

  const selected = chooseType();
  if (!selected) {
    alert("لم يتم إضافة الجهاز، اختر نوعاً صحيحاً");
    return;
  }

  devices.push({
    id: Date.now(),
    name: name.trim(),
    type: selected.type,
    price: selected.price,
    busy: false
  });

  saveDevices();
  renderDevices();
};

renderDevices();
