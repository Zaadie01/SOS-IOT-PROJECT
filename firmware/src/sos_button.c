// sos_button.c - Debounced SOS button handling for HARDWARIO Core Module
// Zephyr RTOS compatible

#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/sys/printk.h>
#include "sos_button.h"

#define BUTTON_PIN 1  // DIO1
#define DEBOUNCE_MS 50

static const struct gpio_dt_spec button_gpios = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
static struct gpio_callback button_cb_data;
static struct device *button_port;

static void button_pressed(const struct device *dev, struct gpio_callback *cb, uint32_t pins) {
    static int64_t last_press = 0;
    int64_t now = k_uptime_get_64();

    if (now - last_press > DEBOUNCE_MS) {
        printk("SOS Button Pressed - Emergency Triggered!\n");
        // Trigger SOS - call external handler or signal
        // In main.c, this would be integrated via callback
        last_press = now;
    }
}

int sos_button_init(struct gpio_callback *cb) {
    int ret;

    button_port = (struct device *)button_gpios.port;
    if (!device_is_ready(button_port)) {
        printk("Button port not ready\n");
        return -1;
    }

    ret = gpio_pin_configure_dt(&button_gpios, GPIO_INPUT | GPIO_PULL_UP);
    if (ret != 0) {
        printk("Error %d configuring button\n", ret);
        return ret;
    }

    ret = gpio_pin_interrupt_configure_dt(&button_gpios, GPIO_INT_EDGE_FALLING);
    if (ret != 0) {
        printk("Error %d configuring interrupt\n", ret);
        return ret;
    }

    gpio_init_callback(&button_cb_data, button_pressed, BIT(button_gpios.pin));
    gpio_add_callback(button_port, &button_cb_data);

    printk("SOS Button initialized\n");
    return 0;
}
