// ==UserScript==
// @name         Auto Etiquetar
// @version      1.1
// @description  Auto atualiza a página com tempos aleatórios, identifica novos ataques e etiqueta-os simulando ações humanas.
// @author       teudm
// @match        https://*.tribalwars.com.br/game.php?*screen=overview_villages*mode=incomings*subtype=attacks*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tribalwars.com.br
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Configurações de chaves de armazenamento
    const STORAGE_KEY = 'tw_saved_incomings';
    const FLAG_JUST_LABELED = 'tw_just_labeled';

    // --- Funções Auxiliares para Comportamento Orgânico ---

    // Retorna um número aleatório entre um mínimo e um máximo (em milissegundos)
    function getRandomTime(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Pausa a execução do script por um determinado tempo
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Função para programar o próximo reload aleatório (entre 3 e 5 minutos)
    function scheduleRandomReload() {
        const minTime = 3 * 60 * 1000; // 3 minutos
        const maxTime = 5 * 60 * 1000; // 5 minutos
        const reloadTime = getRandomTime(minTime, maxTime);

        console.log(`[AutoEtiqueta] Próxima atualização programada para ${(reloadTime / 1000 / 60).toFixed(2)} minutos.`);
        setTimeout(() => window.location.reload(), reloadTime);
    }

    // --- Função para exibir a mensagem na tela ---
    function showSuccessMessage() {
        const div = document.createElement('div');
        div.className = 'autoHideBox success';

        const p = document.createElement('p');
        p.textContent = 'Comandos etiquetados com sucesso';
        p.style.margin = '0';

        div.appendChild(p);
        document.body.appendChild(div);

        // Remove a mensagem após 5 segundos
        setTimeout(() => {
            div.remove();
        }, 5000);
    }

    // --- Função Principal Assíncrona ---
    async function initAutoLabel() {
        // 1. Verifica se a página acabou de ser recarregada após o script clicar em "Etiqueta"
        if (sessionStorage.getItem(FLAG_JUST_LABELED) === 'true') {
            sessionStorage.removeItem(FLAG_JUST_LABELED);
            console.log("[AutoEtiqueta] Comandos foram etiquetados na rodada anterior.");
            showSuccessMessage();
            // Continua o fluxo normal para programar o próximo refresh
        }

        // 2. Fluxo Normal: Verificação de novos comandos
        console.log("[AutoEtiqueta] Verificando se há novos comandos a caminho...");

        // Usar o ID único do comando presente no data-id do span.quickedit
        const currentCommandsNodes = document.querySelectorAll('span.quickedit[data-id]');
        const currentIds = Array.from(currentCommandsNodes).map(node => node.getAttribute('data-id'));

        // Pega os IDs salvos anteriormente no LocalStorage do navegador
        const savedIdsStr = localStorage.getItem(STORAGE_KEY);
        const savedIds = savedIdsStr ? JSON.parse(savedIdsStr) : [];

        // Filtra para encontrar apenas os IDs atuais que NÃO estão na lista de salvos
        const newIds = currentIds.filter(id => !savedIds.includes(id));

        // Atualiza o LocalStorage com a lista atual da tela
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentIds));

        if (newIds.length > 0) {
            console.log(`[AutoEtiqueta] ${newIds.length} novo(s) comando(s) detectado(s). Iniciando seleção orgânica...`);
            let hasCheckedAny = false;

            // Timeout para o PRIMEIRO clique: entre 5 e 10 segundos
            const firstClickDelay = getRandomTime(5000, 10000);
            console.log(`[AutoEtiqueta] Aguardando ${(firstClickDelay/1000).toFixed(1)}s antes do primeiro clique...`);
            await sleep(firstClickDelay);

            // Loop iterando sobre os novos comandos
            for (let i = 0; i < newIds.length; i++) {
                const id = newIds[i];

                // Timeout para os CLIQUES SUBSEQUENTES: entre 1 e 3 segundos
                if (i > 0) {
                    const subsequentDelay = getRandomTime(1000, 3000);
                    await sleep(subsequentDelay);
                }

                const checkbox = document.querySelector(`input[name="id_${id}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                    hasCheckedAny = true;
                    console.log(`[AutoEtiqueta] Input do comando ${id} selecionado.`);
                }
            }

            if (hasCheckedAny) {
                const labelButton = document.querySelector('input[name="label"][type="submit"]');
                if (labelButton) {
                    // Timeout para clicar no SUBMIT: entre 1 e 5 segundos
                    const submitDelay = getRandomTime(1000, 5000);
                    console.log(`[AutoEtiqueta] Todos selecionados. Aguardando ${(submitDelay/1000).toFixed(1)}s antes de clicar em Etiqueta...`);
                    await sleep(submitDelay);

                    console.log("[AutoEtiqueta] Clicando no botão Etiqueta...");
                    sessionStorage.setItem(FLAG_JUST_LABELED, 'true');
                    labelButton.click();
                } else {
                    console.error("[AutoEtiqueta] ERRO: Botão 'Etiqueta' não encontrado na página.");
                    scheduleRandomReload();
                }
            } else {
                scheduleRandomReload();
            }
        } else {
            console.log("[AutoEtiqueta] Nenhum comando novo encontrado.");
            scheduleRandomReload();
        }
    }

    // Aguarda 1 segundo após o carregamento do DOM para garantir que a tabela do jogo foi totalmente renderizada
    console.log("[AutoEtiqueta] Script carregado. Iniciando rotina...");
    setTimeout(initAutoLabel, 1000);

})();