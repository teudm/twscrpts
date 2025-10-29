// ==UserScript==
// @name         Auto Coletar (Loop Inteligente)
// @version      1.0
// @description  Auto coletar recursos com agendamento inteligente baseado no tempo de retorno.
// @author       Teudm
// @match        https://*.tribalwars.com.br/*&screen=place&mode=scavenge*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @downloadURL https://raw.githubusercontent.com/teudm/twscrpts/main/TW1/UserScripts/AutoColetar.user.js
// @updateURL   https://github.com/teudm/tribalwars/raw/main/TW1/UserScripts/AutoColetar.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";
    function parseTimeToMs(timeStr) {
        const parts = timeStr.split(':').map(Number);
        let ms = 0;
        if (parts.length === 3) {
            ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        } else if (parts.length === 2) {
            ms = (parts[0] * 60 + parts[1]) * 1000;
        } else if (parts.length === 1) {
            ms = parts[0] * 1000;
        }
        return ms;
    }

    function randonTime(min, max) {
        min = Number(min);
        max = Number(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    const Scavange = new function () {
        const scavangesWeight = [15, 6, 3, 2];

        const getBlockedScavanges = () => {
            return document.getElementsByClassName("unlock-button").length;
        };

        const getAvailableScavanges = () => {
            return document.getElementsByClassName("free_send_button");
        };

        const getScavangeWeight = () => {
            const blockedScavanges = getBlockedScavanges();
            let weightArray = scavangesWeight;
            if (blockedScavanges > 0) {
                weightArray = weightArray.slice(0, blockedScavanges * -1);
            }
            return weightArray.reduce((item1, item2) => item1 + item2);
        };

        const getAvailableTroops = () => {
            const unitsToAvoid = ["knight", "light"];
            let responseTroops = [];
            const troops = document.getElementsByClassName("units-entry-all");

            for (const troop of troops) {
                var unitType = troop.getAttribute("data-unit");
                if (!unitsToAvoid.includes(unitType)) {
                    responseTroops.push({
                        unit: troop.getAttribute("data-unit"),
                        quantity: parseInt(troop.innerHTML.replace("(", "").replace(")", "")),
                    });
                }
            }
            return responseTroops;
        };

        const calculateScavangeTroops = (scavangeWeight, troops) => {
            const totalWeight = getScavangeWeight();
            const result = [];
            for (const troop of troops) {
                const troopsToSend = Math.floor(
                    (troop.quantity * scavangeWeight) / totalWeight
                );
                result.push({
                    unit: troop.unit,
                    quantityToSend: troopsToSend,
                });
            }
            return result;
        };

        const sendScavange = (weight, troops, element) => {
            const troopsToSend = calculateScavangeTroops(weight, troops);
            for (const troopToSend of troopsToSend) {
                if (troopToSend.quantityToSend) {
                    var inputs = $(`[name=${troopToSend.unit}]`);
                    inputs.val(troopToSend.quantityToSend.toString()).change();
                }
            }
            element.click();
        };

        this.init = () => {
            const troops = getAvailableTroops();
            const availableScavanges = getAvailableScavanges();
            const scavangesUnlocked = scavangesWeight.length - getBlockedScavanges();
            let maxDelay = 0;

            if (availableScavanges.length >= scavangesUnlocked) {
                console.log(`[AutoColeta] ${availableScavanges.length} coletas disponíveis. Enviando...`);
                for (let index = 0; index < availableScavanges.length; index++) {
                    const weight = scavangesWeight[index];
                    const element = availableScavanges[index];

                    const delayTime = 3000 + 3000 * index;
                    setTimeout(() => sendScavange(weight, troops, element), delayTime);
                    maxDelay = delayTime;
                }
            } else {
                console.log(`[AutoColeta] Esperando por ${scavangesUnlocked - availableScavanges.length} coletas terminarem.`);
            }
            return maxDelay;
        };
    };
    function scheduleNextRun() {
        console.log("[AutoColeta] Procurando pelo próximo tempo de retorno...");
        const countdowns = document.querySelectorAll('span.return-countdown');
        let maxDurationMs = 0;

        if (countdowns.length > 0) {
            countdowns.forEach(span => {
                const timeStr = span.textContent.trim();
                const durationMs = parseTimeToMs(timeStr);
                if (durationMs > maxDurationMs) {
                    maxDurationMs = durationMs;
                }
            });
            console.log(`[AutoColeta] Coleta mais longa termina em ${(maxDurationMs / 1000).toFixed(0)}s.`);
        } else {
            console.log("[AutoColeta] Nenhuma coleta ativa encontrada. Verificando em breve.");
            maxDurationMs = randonTime(300000, 600000); 
        }

        const randomBufferMs = randonTime(5000, 30000);
        const nextRunMs = maxDurationMs + randomBufferMs;

        console.log(`[AutoColeta] Próxima execução em ${(nextRunMs / 1000).toFixed(0)} segundos.`);
        setTimeout(runBot, nextRunMs);
    }

    function runBot() {
        console.log("[AutoColeta] Executando verificação...");
        const lastActionDelay = Scavange.init();
        setTimeout(scheduleNextRun, lastActionDelay + 1000);
    }

    console.log("[AutoColeta] Script carregado. Aguardando 1s para iniciar.");
    setTimeout(runBot, 1000);

})();