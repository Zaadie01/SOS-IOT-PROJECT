// application.c - HARDWARIO Core Module firmware for SOS button
// This firmware is currently installed on the device

#include <application.h>

twr_led_t led;
twr_button_t button;
twr_tmp112_t tmp112;

uint16_t button_click_count = 0;

// Button event handler
void button_event_handler(twr_button_t* self, twr_button_event_t event, void* event_param) {
    (void)self;
    (void)event_param;

    twr_log_info("APP: Button event: %i", event);

    // TWR_BUTTON_EVENT_CLICK = 2
    if (event == TWR_BUTTON_EVENT_CLICK) {
        twr_led_set_mode(&led, TWR_LED_MODE_TOGGLE);
        button_click_count++;

        // Send SOS event to serial
        // Being parsed by gateway.js
        twr_log_info("SOS:BUTTON_PRESS:COUNT:%d", button_click_count);
    }
}

// Temperature sensor event handler
void tmp112_event_handler(twr_tmp112_t* self, twr_tmp112_event_t event, void* event_param) {
    (void)event_param;

    if (event == TWR_TMP112_EVENT_UPDATE) {
        float celsius;
        twr_tmp112_get_temperature_celsius(self, &celsius);
        twr_log_info("TEMP:%.2f", celsius);
    }
}

// Application initialization
void application_init(void) {
    twr_log_init(TWR_LOG_LEVEL_DUMP, TWR_LOG_TIMESTAMP_ABS);

    twr_led_init(&led, TWR_GPIO_LED, false, 0);
    twr_led_pulse(&led, 2000);

    twr_button_init(&button, TWR_GPIO_BUTTON, TWR_GPIO_PULL_UP, 0);
    twr_button_set_event_handler(&button, button_event_handler, NULL);

    twr_tmp112_init(&tmp112, TWR_I2C_I2C0, 0x49);
    twr_tmp112_set_event_handler(&tmp112, tmp112_event_handler, NULL);
    twr_tmp112_set_update_interval(&tmp112, 10000);

    // Since we are using a laptop as a gateway,
    // we removed the lines related to the radio module

    // Keep USB active, so he doesn't fall asleep
    twr_module_power_init();  // keep awake
    twr_usb_cdc_init();       // make gateway able to read from device

    twr_log_info("APP: SOS Device initialized");
}