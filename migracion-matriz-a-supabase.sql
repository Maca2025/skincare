-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN · las matrices por producto salen del código y entran a la base
--
-- Mueve PRODUCT_DOSE y PRODUCT_ZONAS de activos-matriz.js a las columnas
-- products.dose_potencias y products.dose_zonas. 87 productos.
--
-- Generado el 2026-08-11 desde activos-matriz.js. NO editar a mano: si hay que
-- rehacerlo, se regenera del archivo para que sea reproducible.
--
-- Una SOLA sentencia, por lo tanto atómica: o entran los 87 o no entra ninguno.
-- Sin tabla temporal a propósito — el editor de Supabase no las conserva entre
-- sentencias. Idempotente: correrlo dos veces deja el mismo resultado.
--
-- Devuelve una fila por producto migrado. Deben ser 87.
-- ════════════════════════════════════════════════════════════════════════

with m (id, dose, zonas) as (
  values
    ('3cef35a0-bc27-440f-9d97-a19709ee2bb9', '{"capilar":70}'::jsonb, '["cabello"]'::jsonb),
    ('d62e61a3-0715-44c3-95bb-a402ca0f73cc', '{"proteccion":null,"aclarado":25}', '["cara","cuello","manos"]'),
    ('57ff2048-f0d3-42a6-a9e5-8e56fb8a564e', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('27826422-4e8b-47a3-a6a0-27f436ce2b26', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('f4f4f34a-d243-41f3-9bb1-dc1ca966d035', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('c495313f-4f9c-49a6-a672-13483a04f0f2', '{"proteccion":null,"aclarado":75}', '["cara","cuello","manos"]'),
    ('7daf598c-e5aa-402f-a26a-6662aa196be9', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('3c1c8b13-bf04-4cf2-a154-5f0d0e2be2ec', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('c998b392-f91e-4ea5-a2b4-9acb871bcc20', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('4c775124-b388-45d0-941f-77cf67c48148', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('6d30d838-50c9-461c-a93a-7e32eba414f0', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('844e871d-3993-47ac-9fbc-d4fe3e7d6a82', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('2026eae7-7ae3-4596-b61f-8b3bb5cd2088', '{"proteccion":null}', '["cara","cuello","manos"]'),
    ('ecef5283-7bdd-460b-a9a8-ccb917942c4c', '{"aclarado":90,"textura":55,"barrera":10}', '["cara","cuello"]'),
    ('3ba97655-b68a-4084-8bec-fd0c4aac09de', '{"textura":25,"aclarado":15}', '["cara","cuello"]'),
    ('1e59f9b3-18b8-4a98-91a0-376a0f8f72f8', '{"firmeza":80,"textura":30,"barrera":15}', '["cara","cuello"]'),
    ('fd5ac61c-3146-49ed-813f-d3b0c4e097aa', '{"firmeza":55,"barrera":45}', '["cara","cuello"]'),
    ('70f8c5ee-c241-41d4-bfe4-2cf4d52a7577', '{"textura":95,"firmeza":85,"aclarado":70}', '["cara","cuello"]'),
    ('35c79583-7aac-405a-b3ba-33276d379984', '{"barrera":60,"textura":40,"aclarado":30}', '["cara","cuello"]'),
    ('9c30b24f-9e2b-422c-8518-0536579cf894', '{"aclarado":55,"barrera":40,"textura":35}', '["cara","cuello"]'),
    ('110a2828-a348-41f3-93b6-bc2b7612d731', '{"textura":70,"aclarado":30,"barrera":10}', '["cara","cuello"]'),
    ('d8085cbe-cae2-4f49-92b5-9f118c9fbdfb', '{"textura":55,"queratolitico":60}', '["cara","cuerpo","pies"]'),
    ('ccea1f6a-4935-44ef-a70a-e332bc9b2b9c', '{"barrera":70}', '["cara","cuerpo"]'),
    ('86cd48aa-fab8-43bf-8275-534d625268e8', '{"textura":65}', '["cara","cuerpo"]'),
    ('4a9ab636-db1f-424f-bcfc-7abc237c673c', '{"barrera":45}', '["cara"]'),
    ('1b656610-fce5-45a6-b6e8-8ec33e209653', '{"aclarado":70,"barrera":25}', '["cara"]'),
    ('9b91d98e-c293-4e27-8cf1-b5faae440bad', '{"textura":20}', '["cara"]'),
    ('d5332696-838e-4d79-9f4e-cde584f0aa91', '{"barrera":65}', '["cara"]'),
    ('900a4aab-bed0-402c-bcb9-a01806886918', '{"barrera":70,"aclarado":15}', '["cara"]'),
    ('20064300-8139-45ef-b803-4e4bf61d94bc', '{"barrera":60,"firmeza":30}', '["cara"]'),
    ('86d57790-31c4-4db8-888f-ffdd6a2465c5', '{"barrera":15}', '["cara"]'),
    ('b73336bc-ad0e-444b-b807-7956498daa5e', '{"barrera":15}', '["cara"]'),
    ('914a738d-a1f7-4657-9f84-53be8ad64b66', '{"barrera":55}', '["cara"]'),
    ('d93e2cfd-b65c-4be1-86af-36fd64108486', '{"textura":10}', '["cara"]'),
    ('837c26e3-6b7c-438a-9664-e63d01d4a9e7', '{"textura":10}', '["cara"]'),
    ('bc6ce9fd-5335-456e-a111-367c21603699', '{"barrera":60}', '["cara"]'),
    ('acbcd16d-c0b0-4fc8-8130-7b61e076f801', '{"barrera":35}', '["cara"]'),
    ('3b90cc0e-7170-4f62-9e99-c582510d6361', '{"barrera":55}', '["cara"]'),
    ('22b2bb98-8431-4d40-8ffe-08f02f3db40b', '{"barrera":65,"aclarado":15}', '["cara"]'),
    ('999186d7-a30e-42c4-914f-b0b76f619b58', '{"aclarado":65,"textura":55,"firmeza":35}', '["cara"]'),
    ('17913609-6130-48bd-977e-45ee06379ff6', '{"barrera":80,"aclarado":20,"firmeza":15}', '["cara"]'),
    ('8a2eb58a-2c7e-47c7-8fe8-532d541e7803', '{"barrera":60}', '["cara"]'),
    ('b3a581cd-c0fd-43e0-8c73-cf043bc7e5a4', '{"firmeza":55,"barrera":55}', '["cara"]'),
    ('feac892a-7a0c-4647-9035-c5278c23cd19', '{"barrera":70,"firmeza":30}', '["cara"]'),
    ('23236746-4738-468c-b043-250f0db91ddb', '{"barrera":25}', '["cara"]'),
    ('0193747b-4c2f-4f7d-ac97-7565c98b94b6', '{"textura":10}', '["cara"]'),
    ('aea54bb5-6e67-4345-8801-d64239f3081f', '{"barrera":60,"aclarado":45,"firmeza":40}', '["cara"]'),
    ('e26cc8e4-79da-4389-baac-852263e51007', '{"aclarado":70}', '["cara"]'),
    ('17bcd631-39a5-4f79-81c1-c494208c2cb1', '{"barrera":10}', '["cara"]'),
    ('d2fa2faa-9408-41cf-8e86-3d3575ae2ac3', '{"textura":40,"barrera":15}', '["cara"]'),
    ('c74e3fdb-3665-438e-9cbb-574459d0e87f', '{"textura":65,"aclarado":55,"barrera":50}', '["cara"]'),
    ('83f81d90-df90-4b65-897c-029c479acb62', '{"firmeza":65,"barrera":45,"aclarado":25}', '["cara"]'),
    ('a6451499-e856-4494-b68b-acdbbc038824', '{"textura":55}', '["cara"]'),
    ('dbe863ae-eb6d-42ad-9565-26cc6ed6e86f', '{"barrera":55,"textura":45,"aclarado":25,"firmeza":15}', '["cara"]'),
    ('a5953eaf-73e5-4ba9-80fa-9979641b62b8', '{"firmeza":45,"aclarado":45,"textura":40,"barrera":25}', '["cara"]'),
    ('83fb4617-acd4-404c-80e5-f4dae81accb6', '{"textura":35,"barrera":20}', '["cara"]'),
    ('5f197c24-5c60-4d16-8bb6-b0c80bd621f8', '{"textura":75}', '["cara"]'),
    ('a6422a1a-1588-4490-bc03-d2b80ade8ff5', '{"textura":60,"aclarado":25}', '["cara"]'),
    ('8d0912a7-441d-4e03-a344-e16076334dbe', '{"textura":85}', '["cara"]'),
    ('21a728f9-3cfa-43eb-a3fe-8a57d417240f', '{"barrera":85}', '["cara"]'),
    ('0dfd4acf-5300-4822-aa77-f048fa588cd8', '{"barrera":30,"textura":15}', '["cara"]'),
    ('b06008de-44b8-4d11-b6a8-0de0dc543bed', '{"aclarado":85,"firmeza":60,"textura":20}', '["cara"]'),
    ('f95c263b-102e-46c9-bc24-485bf192cdc9', '{"barrera":40,"firmeza":35,"aclarado":30}', '["cara"]'),
    ('d6f17e28-ccb7-4267-a588-5812bdfa2fde', '{"barrera":85,"aclarado":20}', '["cara"]'),
    ('b71bc26f-a501-49eb-8461-c7485192ee48', '{"barrera":35,"firmeza":20,"aclarado":20}', '["cara"]'),
    ('d944830f-82e8-434e-8409-dd7a89997fd9', '{"barrera":40,"firmeza":20}', '["cuello"]'),
    ('f0797f0c-1ccc-42fa-b3c2-3ba82ecd419a', '{"firmeza":60,"barrera":30}', '["cuello"]'),
    ('6b2ab52e-8479-4016-a8eb-2a61864491f7', '{"firmeza":55,"barrera":40}', '["cuello"]'),
    ('5e0fd428-5d22-41ed-91d9-bcd57fddad20', '{"proteccion":null}', '["cuerpo","manos"]'),
    ('b4b6743b-2aa6-468f-9662-b6d9d1cc1736', '{"proteccion":null}', '["cuerpo","manos"]'),
    ('7454f16a-51b3-44c9-b392-4d97b50038b8', '{"barrera":35}', '["cuerpo"]'),
    ('bc090811-c158-4bd2-b97a-6f83f0de7a24', '{"firmeza":60,"textura":50,"barrera":30}', '["cuerpo"]'),
    ('dcff4486-a13e-4bef-a4d3-9fce38945ac2', '{"barrera":55,"firmeza":45,"textura":35}', '["cuerpo"]'),
    ('2b41c15a-bbab-4a44-b583-476d0f11f3f9', '{"barrera":75}', '["cuerpo"]'),
    ('05f7037d-f73b-4ff8-9081-c64afb2c5cf2', '{"textura":40,"firmeza":45}', '["cuerpo"]'),
    ('50e32222-59b0-4b20-ad26-23b552f91239', '{"textura":70}', '["cuerpo"]'),
    ('be7a694e-0211-4d3f-b9ed-0c2d83f05943', '{"labial":60}', '["labios"]'),
    ('34b622c4-e4bf-4289-b8a6-923632995796', '{"labial":70}', '["labios"]'),
    ('6cfe7393-865c-4af0-b1bf-5d90e7cd52de', '{"aclarado":15}', '["manos"]'),
    ('106e6207-662c-451d-ac3c-5c8c1db73883', '{"aclarado":60}', '["manos"]'),
    ('6447629f-d5f2-4a83-b011-006b25cf18e3', '{"queratolitico":90}', '["pies"]'),
    ('f5419858-d505-4621-9379-bdedad67dd50', '{"queratolitico":85}', '["pies"]'),
    ('44b6586f-754c-49a0-b6f6-867d77bd2e44', '{"queratolitico":45}', '["pies"]'),
    ('c3e2d898-e5d3-4e00-879a-827e84a44854', '{"queratolitico":65}', '["pies"]'),
    ('c6fac7f0-2900-4eb9-910d-440b65e5a53d', '{"queratolitico":80}', '["pies"]'),
    ('3d201bba-ff43-413e-b96b-3c443bec8057', '{"queratolitico":85}', '["pies"]'),
    ('786a92d8-a357-4053-9b4b-d5c96ae9e821', '{"queratolitico":95}', '["pies"]')
)
update products p
   set dose_potencias = m.dose,
       dose_zonas     = m.zonas
  from m
 where p.id::text = m.id
returning p.id, p.name, p.dose_potencias, p.dose_zonas;
