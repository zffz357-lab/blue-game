/* BLUE GAME - Shared database operations */
(function () {
  "use strict";

  const api = {
    client: null,
    channel: null,

    connect(client) {
      if (!client || typeof client.rpc !== "function") {
        throw new Error("Supabase client غير جاهز");
      }
      this.client = client;
      return this;
    },

    async call(name, params = {}) {
      if (!this.client) throw new Error("الاتصال بقاعدة البيانات غير مهيأ");
      const { data, error } = await this.client.rpc(name, params);
      if (error) throw error;
      return data;
    },

    async loadDevices() {
      if (!this.client) throw new Error("الاتصال غير مهيأ");
      const { data, error } = await this.client
        .from("shop_devices")
        .select("device_id,device_name,device_type,session,updated_at")
        .order("device_id");
      if (error) throw error;
      return data || [];
    },

    async addDevice(id, name, type = "ثنائي") {
      return this.call("add_shop_device", {
        p_device_id: Number(id),
        p_device_name: name,
        p_device_type: type
      });
    },

    async startSession(id, type, mode, minutes = null) {
      return this.call("start_shop_session", {
        p_device_id: Number(id),
        p_device_type: type,
        p_mode: mode,
        p_duration_minutes: minutes
      });
    },

    async addPurchase(id, name, quantity) {
      return this.call("add_shop_purchase", {
        p_device_id: Number(id),
        p_product_name: name,
        p_quantity: Number(quantity)
      });
    },

    async finishSession(id) {
      return this.call("finish_shop_session", {
        p_device_id: Number(id)
      });
    },

    async createWorkerCode(label) {
      return this.call("create_worker_activation_code", {
        p_device_label: label
      });
    },

    async activateWorker(code) {
      return this.call("activate_shop_worker", {
        p_code: code
      });
    },

    async revokeWorker(id) {
      return this.call("revoke_shop_worker", {
        p_worker_device_id: id
      });
    },

    async listWorkers() {
      return this.call("list_shop_workers");
    },

    async migrateOldData() {
      return this.call("bootstrap_shop_data");
    },

    async loadInvoices() {
      if (!this.client) throw new Error("الاتصال غير مهيأ");
      const { data, error } = await this.client
        .from("shop_invoices")
        .select("id,invoice,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    watchDevices(onChange) {
      if (!this.client) throw new Error("الاتصال غير مهيأ");
      if (this.channel) this.client.removeChannel(this.channel);

      this.channel = this.client
        .channel("blue-game-shared-devices")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "shop_devices"
          },
          async () => {
            try {
              onChange(await this.loadDevices());
            } catch (error) {
              console.error("تحديث الأجهزة فشل:", error);
            }
          }
        )
        .subscribe();

      return this.channel;
    },

    disconnect() {
      if (this.channel && this.client) {
        this.client.removeChannel(this.channel);
      }
      this.channel = null;
      this.client = null;
    }
  };

  window.BLUE_GAME_SHARED = api;
})();
