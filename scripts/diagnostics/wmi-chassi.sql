-- Confere a tabela de WMI (3 primeiros caracteres do chassi) usada em
-- backend/src/modules/hinova/tipo-veiculo.ts.
--
-- Critério: só entra WMI com pelo menos 100 registros no espelho do SGA e pelo
-- menos 99% dos casos de um lado só. Rodar depois de um sync grande; se algum
-- WMI da lista sair do critério, a lista no código precisa ser revista.
--
--   docker exec -i <postgres> psql -U postgres -d rastreamento21go -f este-arquivo
select
  left(chassi, 3) as wmi,
  count(*) as total,
  round(
    100.0 * count(*) filter (
      where vehicle_type ~* 'MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER'
    ) / count(*),
    1
  ) as pct_moto
from sga_vehicles
where chassi is not null
  and length(chassi) >= 3
  and vehicle_type is not null
group by 1
having count(*) >= 100
   and (
     100.0 * count(*) filter (
       where vehicle_type ~* 'MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER'
     ) / count(*) >= 99
     or 100.0 * count(*) filter (
       where vehicle_type ~* 'MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER'
     ) / count(*) <= 1
   )
order by pct_moto desc, total desc;

-- Veículos nossos em que as duas fontes discordam — é o que precisa de olho
-- humano, nunca de palpite do código.
select v.plate, v.model, v.chassi, v.vehicle_type as tipo_gravado, sv.vehicle_type as tipo_sga
from vehicles v
join sga_vehicles sv
  on sv.tenant_id = v.tenant_id
 and (sv.plate = v.plate or (v.chassi is not null and sv.chassi = v.chassi))
where v.deleted_at is null
  and sv.vehicle_type is not null
  and (
    (left(v.chassi, 3) in ('99H', '9C2', '9C6')
      and sv.vehicle_type !~* 'MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER')
    or (left(v.chassi, 3) in ('9BG','9BD','9BW','93Y','9BF','9BH','93H','9BR','94D','8AP',
                              '988','LC0','935','3N1','KNA','936','8AG','KMH','8AD','95P','8A1')
      and sv.vehicle_type ~* 'MOTOCICL|MOTONETA|CICLOMOTOR|SCOOTER')
  );
