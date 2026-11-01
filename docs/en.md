# dingz

**Unofficial** integration of the [dingz](https://www.dingz.ch) smart switches (iolo AG) for Gladys Assistant. It drives the dingz through their **local REST API**: nothing goes through the cloud.

## What is supported

Each dingz becomes **one device** in Gladys, with the features matching its wiring:

| On the dingz                  | In Gladys                                    |
| ----------------------------- | -------------------------------------------- |
| Light output                  | Light on/off                                 |
| Dimmable light output         | Light on/off + brightness (%)                |
| Other output (socket, fan...) | Switch on/off                                |
| Motor (blind, shutter)        | Open / close / stop, position (%), slats (%) |
| Temperature sensor            | Temperature (°C)                             |
| Light sensor                  | Light level (lux)                            |
| Motion detector (PIR front)   | Motion                                       |
| Per-output metering           | Power (W)                                    |

The names come from the dingz configuration (dingz name, room, outputs and blinds). For blinds, 0 % = closed and 100 % = open.

## Setup

1. Give each dingz a **fixed IP address** in your router (recommended).
2. Install the integration, then open **Configuration**.
3. Keep **Automatic discovery (UDP)** enabled: the dingz announce themselves on UDP port 7979. If your dingz are on another network or VLAN than Gladys, enter their addresses in **dingz addresses** instead (comma-separated).
4. Click **Search and test the dingz**: the result lists the reachable dingz.
5. In the **Discovery** tab, add the dingz you want and assign them a room.

## Settings

- **Refresh interval**: each dingz is read every 5 seconds by default. It is also the delay before Gladys sees a button pressed by hand or a motion. After a command sent from Gladys, the dingz is read right away, then every 2 seconds while a blind moves.
- **Identify a dingz**: blinks the front LED red, then restores it.

## Good to know

- The REST API must be enabled on the dingz (it is by default). UDP discovery is enabled in the dingz web app, under **Settings > Services**.
- If a dingz gets a new IP address, the integration searches again automatically (at most every 5 minutes).
- Button presses on the dingz are not forwarded as events: only the resulting output state is visible, at the next refresh.
- dingz plus (DDI / DALI) and the thermostat are not supported yet.

This connector is not affiliated with or endorsed by iolo AG. dingz is a trademark of iolo AG.
