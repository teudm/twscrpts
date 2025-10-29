getDepositInformation = () => socketService.emit(routeProvider.RESOURCE_DEPOSIT_GET_INFO, {}, function(data){
  return data;
});


(async function() {
  try {
    const socketService = injector.get('socketService');
    const routeProvider = injector.get('routeProvider');
    const modelDataService = injector.get('modelDataService');
    const currentVillageId = modelDataService.getSelectedVillage().data.villageId;

    const depositInfosPromise = new Promise((resolve, reject) => {
      socketService.emit(routeProvider.RESOURCE_DEPOSIT_GET_INFO, {}, function(data) {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });
    });

    const data = await depositInfosPromise;

    console.log("Dados recebidos do depósito:", data);
    
    if (data.jobs && data.jobs.length > 0) {
      console.log("Jobs encontrados:");
      data.jobs.forEach(job => {
        console.log(`- Tipo: ${job.resource_type}, Tempo: ${job.duration} segundos, Estado: ${job.state === 1 ? 'Pronto para coletar' : 'Em progresso'}`);
        if (job.state === 1) {
          console.log("  Coletando recursos...");
          socketService.emit(routeProvider.RESOURCE_DEPOSIT_COLLECT, { "job_id": job.id, "village_id": currentVillageId}, function() {});
        }
      });
    } else {
      console.log("Nenhum job ativo no depósito.");
    }

  } catch (error) {
    console.error("Falha ao buscar dados do depósito:", error);
  }
})();