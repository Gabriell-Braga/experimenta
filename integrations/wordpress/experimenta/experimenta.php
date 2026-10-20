<?php
/**
 * Plugin Name: Experimenta — testes A/B
 * Description: Instala o snippet do Experimenta no início do <head>, identifica usuários logados (opcional) e manda as compras do WooCommerce como conversão (opcional).
 * Version: 1.0.0
 * Requires at least: 5.0
 * Requires PHP: 7.0
 * License: MIT
 * Text Domain: experimenta
 */

if (!defined('ABSPATH')) {
	exit;
}

// Preenchido pelo editor ao baixar o plugin (Configurar → Integrações → WordPress).
const EXPERIMENTA_DEFAULT_URL = '__EXPERIMENTA_SCRIPT_URL__';
const EXPERIMENTA_OPTION = 'experimenta_settings';

/** Configuração salva, com os padrões. */
function experimenta_settings() {
	$default_url = strpos(EXPERIMENTA_DEFAULT_URL, '__') === 0 ? '' : EXPERIMENTA_DEFAULT_URL;
	$saved = get_option(EXPERIMENTA_OPTION, array());
	return array_merge(
		array(
			'url' => $default_url,
			'position' => 'first',
			'identify' => '0',
			'woocommerce' => '1',
		),
		is_array($saved) ? $saved : array()
	);
}

/** Só aceita URL https (ou http em localhost) terminada em .js. */
function experimenta_sanitize($input) {
	$input = is_array($input) ? $input : array();
	$url = isset($input['url']) ? esc_url_raw(trim($input['url'])) : '';
	if ($url !== '' && !preg_match('#^(https://|http://(localhost|127\.0\.0\.1)(:\d+)?/)[^\s"\'<>]+\.js$#', $url)) {
		add_settings_error(EXPERIMENTA_OPTION, 'url', 'URL do script inválida: copie a do editor (termina em .js).');
		$url = experimenta_settings()['url'];
	}
	return array(
		'url' => $url,
		'position' => (isset($input['position']) && $input['position'] === 'late') ? 'late' : 'first',
		'identify' => empty($input['identify']) ? '0' : '1',
		'woocommerce' => empty($input['woocommerce']) ? '0' : '1',
	);
}

/** Snippet no <head>: "first" = antes de tudo o que usa wp_head (recomendado, evita piscar). */
function experimenta_head() {
	$s = experimenta_settings();
	if ($s['url'] === '') {
		return;
	}
	echo '<script src="' . esc_url($s['url']) . '"></script>' . "\n";
	if ($s['identify'] === '1' && is_user_logged_in()) {
		$user = wp_get_current_user();
		echo '<script>window.abq=window.abq||[];abq.push(["identify",' . wp_json_encode('wp-' . $user->ID) . ',{"email":' . wp_json_encode($user->user_email) . '}]);</script>' . "\n";
	}
}

/** WooCommerce: compra na página de obrigado (uma vez por pedido) → abq.push(['purchase', ids, total]). */
function experimenta_purchase($order_id) {
	$s = experimenta_settings();
	if ($s['url'] === '' || $s['woocommerce'] !== '1' || !function_exists('wc_get_order')) {
		return;
	}
	$order = wc_get_order($order_id);
	if (!$order || $order->get_meta('_experimenta_tracked')) {
		return;
	}
	$ids = array();
	foreach ($order->get_items() as $item) {
		$ids[] = (string) $item->get_product_id();
	}
	echo '<script>window.abq=window.abq||[];abq.push(["purchase",' . wp_json_encode($ids) . ',' . wp_json_encode((float) $order->get_total()) . ']);</script>' . "\n";
	$order->update_meta_data('_experimenta_tracked', '1');
	$order->save();
}

function experimenta_boot() {
	$s = experimenta_settings();
	add_action('wp_head', 'experimenta_head', $s['position'] === 'late' ? 100 : -1000);
	add_action('woocommerce_thankyou', 'experimenta_purchase', 10, 1);
}
add_action('plugins_loaded', 'experimenta_boot');

// ---------- Configurações → Experimenta ----------
function experimenta_admin_init() {
	register_setting('experimenta', EXPERIMENTA_OPTION, array('sanitize_callback' => 'experimenta_sanitize'));
}
add_action('admin_init', 'experimenta_admin_init');

function experimenta_admin_menu() {
	add_options_page('Experimenta', 'Experimenta', 'manage_options', 'experimenta', 'experimenta_page');
}
add_action('admin_menu', 'experimenta_admin_menu');

function experimenta_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$s = experimenta_settings();
	$name = EXPERIMENTA_OPTION;
	?>
	<div class="wrap">
		<h1>Experimenta</h1>
		<?php settings_errors(EXPERIMENTA_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('experimenta'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="experimenta-url">URL do script</label></th>
					<td>
						<input id="experimenta-url" class="regular-text code" type="url" name="<?php echo esc_attr($name); ?>[url]" value="<?php echo esc_attr($s['url']); ?>" placeholder="https://…/cdn/sua-conta.js">
						<p class="description">Copie em Configurar → Instalação no editor do Experimenta.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="experimenta-position">Posição no &lt;head&gt;</label></th>
					<td>
						<select id="experimenta-position" name="<?php echo esc_attr($name); ?>[position]">
							<option value="first" <?php selected($s['position'], 'first'); ?>>Primeiro (recomendado: as variações entram sem piscar)</option>
							<option value="late" <?php selected($s['position'], 'late'); ?>>Depois dos outros scripts do tema</option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row">Opções</th>
					<td>
						<label><input type="checkbox" name="<?php echo esc_attr($name); ?>[identify]" value="1" <?php checked($s['identify'], '1'); ?>> Identificar usuários logados (id e e-mail vão para os perfis)</label><br>
						<label><input type="checkbox" name="<?php echo esc_attr($name); ?>[woocommerce]" value="1" <?php checked($s['woocommerce'], '1'); ?>> WooCommerce: compra como evento <code>purchase</code> com o valor do pedido</label>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}
