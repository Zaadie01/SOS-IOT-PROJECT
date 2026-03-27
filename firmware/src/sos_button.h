#ifndef SOS_BUTTON_H
#define SOS_BUTTON_H

#include <zephyr/drivers/gpio.h>

int sos_button_init(struct gpio_callback *cb);

#endif // SOS_BUTTON_H
