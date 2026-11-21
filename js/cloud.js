const CLOUD_URL = "https://bpfqyraojccezipknkuz.supabase.co";
const CLOUD_KEY = "sb_publishable_43JkrQrBCYvX1mD36hXutw_xtX1ld3X";
const PENDING_KEY = "blueGamePendingCloudSync";

let cloudClient;
let cloudOwner = null;
let cloudReady = false;
let cloudSaveTimer = null;
let cloudChannel = null;
let cloudInventory = [];
let authMode = "login";

function authMessage(message) {
  document.getElementById("authMessage").textContent = message;
}

function syncMessage(message) {
  document.getElementById("syncStatus").textContent = message;
}

async function pushCloudData() {
  const { error } = await cloudClient.from("shop_data").upsert({
    owner_id: cloudOwner.id,
    devices: devices,
    invoices: invoices,
    inventory: cloudInventory,
    updated_at: new Date().toISOString()
  }, { onConflict: "owner_id" });

  if (error) {
    localStorage.setItem(PENDING_KEY, "1");
    throw error;
  }

  localStorage.removeItem(PENDING_KEY);
  syncMessage("☁️ البيانات متزامنة");
}

function queueCloudSave() {
  if (!cloudReady) return;

  if (!cloudOwner) {
    localStorage.setItem(PENDING_KEY, "1");
    return;
  }

  clearTimeout(cloudSaveTimer);
  syncMessage("⏳ جارٍ حفظ البيانات...");
  cloudSaveTimer = setTimeout(() => {
    pushCloudData().catch(error => {
      console.error(error);
      syncMessage("⚠️ تعذر الاتصال - البيانات محفوظة محلياً");
    });
  }, 700);
}

async function openOwnerSession(session) {
  cloudOwner = session.user;

  if (!window.BLUE_GAME_SHARED || !window.BLUE_GAME_SHARED.client) {
    throw new Error("نظام البيانات المشتركة غير متصل");
  }

  const { data: legacyData, error: legacyError } = await cloudClient
    .from("shop_data")
    .select("inventory")
    .eq("owner_id", cloudOwner.id)
    .maybeSingle();

  if (legacyError) throw legacyError;

  cloudInventory = legacyData?.inventory || [];

  // نقل الأجهزة والأسعار والمنتجات القديمة مرة واحدة، دون الفواتير.
  await window.BLUE_GAME_SHARED.migrateOldData();

  const [deviceRows, invoiceRows, rateResult] = await Promise.all([
    window.BLUE_GAME_SHARED.loadDevices(),
    window.BLUE_GAME_SHARED.loadInvoices(),
    cloudClient.from("shop_rates").select("device_type,hourly_price")
  ]);

  if (rateResult.error) throw rateResult.error;

  const rates = {};
  (rateResult.data || []).forEach(rate => {
    rates[rate.device_type] = Number(rate.hourly_price);
  });

  function applySharedDevices(rows) {
    devices = (rows || []).map(row => ({
      id: row.device_id,
      name: row.device_name,
      type: row.device_type,
      price: rates[row.device_type] || 0,
      session: row.session || null,
      busy: !!row.session
    }));

    localStorage.setItem("blueGameDevices", JSON.stringify(devices));
    renderDevices();
  }

  applySharedDevices(deviceRows);

  invoices = (invoiceRows || []).map(row => row.invoice);
  localStorage.setItem("blueGameInvoices", JSON.stringify(invoices));

  cloudReady = true;
  document.getElementById("authGate").hidden = true;
  document.querySelector("main").hidden = false;
  document.getElementById("accountBar").hidden = false;
  document.getElementById("accountEmail").textContent = cloudOwner.email || "";
  renderDevices();
  syncMessage("☁️ البيانات محمّلة من النظام المشترك");

  if (cloudChannel) {
    await cloudClient.removeChannel(cloudChannel);
    cloudChannel = null;
  }

  cloudChannel = window.BLUE_GAME_SHARED.watchDevices(rows => {
    applySharedDevices(rows);
    syncMessage("🔄 تم تحديث الأجهزة من جهاز آخر");
  });
}

async function initCloudAuth() {
  if (!window.supabase || !window.supabase.createClient) {
    authMessage("تعذر تحميل خدمة الاتصال. تحقق من الإنترنت.");
    return;
  }

  cloudClient = window.supabase.createClient(CLOUD_URL, CLOUD_KEY);
  window.cloudClient = cloudClient;
  if (window.BLUE_GAME_SHARED) {
    window.BLUE_GAME_SHARED.connect(cloudClient);
  }

  document.getElementById("authToggle").onclick = () => {
    authMode = authMode === "login" ? "signup" : "login";
    document.getElementById("authTitle").textContent =
      authMode === "login" ? "🔐 دخول صاحب المحل" : "إنشاء حساب صاحب المحل";
    document.getElementById("authSubmit").textContent =
      authMode === "login" ? "تسجيل الدخول" : "إنشاء الحساب";
    document.getElementById("authToggle").textContent =
      authMode === "login" ? "إنشاء حساب جديد" : "لدي حساب - تسجيل الدخول";
    authMessage("");
  };

  document.getElementById("authForm").onsubmit = async event => {
    event.preventDefault();

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    document.getElementById("authSubmit").disabled = true;
    authMessage("يرجى الانتظار...");

    try {
      let result;

      if (authMode === "signup") {
        result = await cloudClient.auth.signUp({ email, password });

        if (!result.error && !result.data.session) {
          authMessage("تم إنشاء الحساب. افحص بريدك لتأكيده، ثم سجّل الدخول.");
          return;
        }
      } else {
        result = await cloudClient.auth.signInWithPassword({ email, password });
      }

      if (result.error) throw result.error;
      await openOwnerSession(result.data.session);
    } catch (error) {
      authMessage("تعذر إتمام العملية: " + error.message);
    } finally {
      document.getElementById("authSubmit").disabled = false;
    }
  };

  document.getElementById("signOut").onclick = async () => {
    if (cloudChannel) await cloudClient.removeChannel(cloudChannel);
    await cloudClient.auth.signOut();
    cloudOwner = null;
    cloudReady = false;
    document.querySelector("main").hidden = true;
    document.getElementById("accountBar").hidden = true;
    document.getElementById("authGate").hidden = false;
  };

  const { data, error } = await cloudClient.auth.getSession();

  if (error) {
    authMessage(error.message);
    return;
  }

  if (data.session) {
    try {
      await openOwnerSession(data.session);
    } catch (error) {
      authMessage("تعذر تحميل بيانات المحل: " + error.message);
    }
  }
}
